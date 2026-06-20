import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

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

function SubscriptionCard({
  sub,
  onCancel,
  cancelling,
  fetchWithAuth,
  onAlert,
  onUpdate,
}: {
  sub: Subscription;
  onCancel: (sub: Subscription) => void;
  cancelling: boolean;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  onAlert: (a: { type: "success" | "error"; message: string }) => void;
  onUpdate: (id: number, patch: { cancelAtPeriodEnd: boolean; cancelAt: number | null; currentPeriodEnd: number | null }) => void;
}) {
  const [portalLoading, setPortalLoading] = useState(false);
  const [resubLoading, setResubLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);

  const stripe = sub.stripe;
  const isCanceled = stripe?.status === "canceled";
  const isCancelPending = stripe?.cancelAtPeriodEnd === true && !isCanceled;
  const isActive = stripe
    ? (stripe.status === "active" || stripe.status === "trialing")
    : sub.status === "active";
  const cancelAt = stripe?.cancelAt ?? null;
  const amount = stripe?.amount;
  const currency = stripe?.currency ?? "usd";

  // Use exact current_period_end when available; fall back to anchor estimate
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

  const handleResume = async () => {
    setResumeLoading(true);
    try {
      const res = await fetchWithAuth(`/api/portal/billing/subscriptions/${sub.id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json() as { cancelAtPeriodEnd: boolean; cancelAt: number | null; currentPeriodEnd: number | null };
        onAlert({ type: "success", message: `Your ${sub.serviceName} retainer has been resumed and will continue renewing.` });
        onUpdate(sub.id, { cancelAtPeriodEnd: data.cancelAtPeriodEnd, cancelAt: data.cancelAt, currentPeriodEnd: data.currentPeriodEnd });
      } else {
        const err = await res.json() as { error: string };
        onAlert({ type: "error", message: err.error ?? "Could not resume subscription. Please try again." });
      }
    } catch {
      onAlert({ type: "error", message: "Network error. Please try again." });
    } finally {
      setResumeLoading(false);
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

  return (
    <div className="px-5 py-5 flex items-start gap-4 flex-wrap sm:flex-nowrap">
      <div className="w-10 h-10 rounded-xl bg-[#00B4D8]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg className="w-5 h-5 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <p className="text-sm font-bold text-[#0A2540]">{sub.serviceName}</p>
          {isCanceled ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-gray-100 text-gray-500 border-gray-200">
              Canceled
            </span>
          ) : isCancelPending ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-orange-100 text-orange-700 border-orange-200">
              Cancels {cancelAt ? formatDate(cancelAt) : "at period end"}
            </span>
          ) : isActive ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-green-100 text-green-700 border-green-200">
              Active
            </span>
          ) : (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-gray-100 text-gray-500 border-gray-200">
              {stripe?.status ?? sub.status}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {amount !== null && amount !== undefined && (
            <span className="font-medium text-[#0A2540]">
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
          <button
            onClick={() => void handleResubscribe()}
            disabled={resubLoading}
            className="flex items-center gap-1.5 text-xs font-semibold bg-[#0078D4] text-white px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/90 transition-colors disabled:opacity-50"
          >
            {resubLoading ? (
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : null}
            Re-purchase
          </button>
        )}

        {isCancelPending && sub.stripeSubscriptionId && (
          <button
            onClick={() => void handleResume()}
            disabled={resumeLoading}
            className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {resumeLoading ? (
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : null}
            Resume subscription
          </button>
        )}

        {!isCancelPending && !isCanceled && isActive && sub.stripeSubscriptionId && (
          <>
            <button
              onClick={() => void handleManagePayment()}
              disabled={portalLoading}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 border border-[#0078D4]/30 hover:border-[#0078D4]/60 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {portalLoading ? (
                <span className="w-3.5 h-3.5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              ) : null}
              Manage payment method
            </button>
            <button
              onClick={() => onCancel(sub)}
              disabled={cancelling}
              className="text-xs font-semibold text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel subscription
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CancelDialog({
  sub,
  onConfirm,
  onClose,
  loading,
}: {
  sub: Subscription;
  onConfirm: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  const periodEnd = sub.stripe?.cancelAt;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 z-10">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        <h2 className="text-lg font-bold text-[#0A2540] mb-2">Cancel subscription?</h2>
        <p className="text-sm text-muted-foreground mb-2">
          You're about to cancel your <strong>{sub.serviceName}</strong> retainer.
        </p>
        {periodEnd ? (
          <p className="text-sm text-muted-foreground mb-6">
            You'll retain access until <strong>{formatDate(periodEnd)}</strong>, then the subscription won't renew. No further charges will be made.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mb-6">
            Your access will continue through the end of the current billing period. No further charges will be made.
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 border border-border text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Keep subscription
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 bg-red-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : null}
            Yes, cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PortalBilling() {
  const { fetchWithAuth } = useAuth();
  const [location, navigate] = useLocation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [stripeReceipts, setStripeReceipts] = useState<StripeReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [subLoading, setSubLoading] = useState(true);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [paying, setPayingId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [alert, setAlert] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      setAlert({ type: "success", message: "Payment successful! Your invoice will be marked as paid shortly." });
    } else if (params.get("payment") === "cancelled") {
      setAlert({ type: "error", message: "Payment was cancelled. You can try again at any time." });
    }
  }, [location]);

  useEffect(() => {
    fetchWithAuth("/api/portal/invoices")
      .then(r => r.json())
      .then(d => setInvoices(d as Invoice[]))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  useEffect(() => {
    fetchWithAuth("/api/portal/billing/subscriptions")
      .then(r => r.json())
      .then(d => setSubscriptions(d as Subscription[]))
      .catch(() => null)
      .finally(() => setSubLoading(false));
  }, [fetchWithAuth]);

  useEffect(() => {
    fetchWithAuth("/api/portal/billing/stripe-receipts")
      .then(r => r.json())
      .then(d => setStripeReceipts(d as StripeReceipt[]))
      .catch(() => null)
      .finally(() => setReceiptsLoading(false));
  }, [fetchWithAuth]);

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
        setSubscriptions(prev => prev.map(s =>
          s.id === cancelTarget.id
            ? {
                ...s,
                stripe: s.stripe
                  ? { ...s.stripe, cancelAtPeriodEnd: data.cancelAtPeriodEnd, cancelAt: data.cancelAt, billingCycleAnchor: data.billingCycleAnchor }
                  : null,
              }
            : s
        ));
        setCancelTarget(null);
        setAlert({ type: "success", message: `Your ${cancelTarget.serviceName} retainer will not renew after the current billing period.` });
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

  const totalDue = invoices.filter(i => i.status === "due" || i.status === "overdue")
    .reduce((sum, i) => sum + parseFloat(i.amount), 0);
  const totalPaid = invoices.filter(i => i.status === "paid")
    .reduce((sum, i) => sum + parseFloat(i.amount), 0);

  const activeSubscriptions = subscriptions.filter(s =>
    s.stripe ? (s.stripe.status === "active" || s.stripe.status === "trialing") : s.status === "active"
  );

  return (
    <PortalLayout>
      <div className="px-6 py-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-[#0A2540]">Billing & Invoices</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your retainer subscriptions and view invoices.</p>
        </div>

        {alert && (
          <div className={`mb-6 flex items-center gap-3 px-4 py-3 rounded-xl border ${
            alert.type === "success" ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"
          }`}>
            {alert.type === "success" ? (
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            ) : (
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            )}
            <p className="text-sm font-medium">{alert.message}</p>
            <button onClick={() => setAlert(null)} className="ml-auto text-current/60 hover:text-current transition-colors">✕</button>
          </div>
        )}

        {/* ── Monthly Retainers ────────────────────────────────────────── */}
        {(subLoading || subscriptions.length > 0) && (
          <div className="mb-8">
            <h2 className="text-base font-bold text-[#0A2540] mb-3">Monthly Retainers</h2>
            {subLoading ? (
              <div className="bg-white border border-border rounded-xl p-6 flex items-center gap-3 text-muted-foreground text-sm">
                <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                Loading subscriptions…
              </div>
            ) : activeSubscriptions.length === 0 && subscriptions.length === 0 ? null : (
              <div className="bg-white border border-border rounded-xl overflow-hidden">
                <div className="divide-y divide-border">
                  {subscriptions.map(sub => (
                    <SubscriptionCard
                      key={sub.id}
                      sub={sub}
                      onCancel={setCancelTarget}
                      cancelling={cancelling && cancelTarget?.id === sub.id}
                      fetchWithAuth={fetchWithAuth}
                      onAlert={setAlert}
                      onUpdate={(id, patch) => setSubscriptions(prev => prev.map(s =>
                        s.id === id
                          ? { ...s, stripe: s.stripe ? { ...s.stripe, cancelAtPeriodEnd: patch.cancelAtPeriodEnd, cancelAt: patch.cancelAt, currentPeriodEnd: patch.currentPeriodEnd } : null }
                          : s
                      ))}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Invoice summary cards ─────────────────────────────────────── */}
        {!loading && invoices.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-white border border-border rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Total Invoiced</p>
              <p className="text-xl font-extrabold text-[#0A2540]">
                {formatCurrency(String(invoices.reduce((s, i) => s + parseFloat(i.amount), 0)), "usd")}
              </p>
            </div>
            <div className="bg-white border border-border rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Amount Paid</p>
              <p className="text-xl font-extrabold text-green-700">{formatCurrency(String(totalPaid), "usd")}</p>
            </div>
            <div className="bg-white border border-border rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Outstanding</p>
              <p className={`text-xl font-extrabold ${totalDue > 0 ? "text-red-600" : "text-[#0A2540]"}`}>
                {formatCurrency(String(totalDue), "usd")}
              </p>
            </div>
          </div>
        )}

        {/* ── Invoice list ──────────────────────────────────────────────── */}
        <h2 className="text-base font-bold text-[#0A2540] mb-3">Invoice History</h2>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="bg-white border border-border rounded-xl p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <h3 className="text-[#0A2540] font-bold mb-2">No invoices yet</h3>
            <p className="text-muted-foreground text-sm">Your invoices will appear here.</p>
          </div>
        ) : (
          <div className="bg-white border border-border rounded-xl overflow-hidden">
            <div className="divide-y divide-border">
              {invoices.map(inv => {
                const config = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.draft;
                const canPay = inv.status === "due" || inv.status === "overdue";
                return (
                  <div
                    key={inv.id}
                    onClick={() => navigate(`/portal/billing/invoices/${inv.id}`)}
                    className="px-5 py-4 flex items-center gap-4 flex-wrap sm:flex-nowrap hover:bg-[#F7F9FC] transition-colors group cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-sm font-bold text-[#0A2540] group-hover:text-[#0078D4] transition-colors">{inv.invoiceNumber}</p>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${config.classes}`}>{config.label}</span>
                      </div>
                      {inv.description && <p className="text-xs text-muted-foreground truncate">{inv.description}</p>}
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                        {inv.dueDate && inv.status !== "paid" && (
                          <span>Due {new Date(inv.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                        )}
                        {inv.paidAt && (
                          <span className="text-green-600 font-medium">Paid {new Date(inv.paidAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
                      <p className="text-base font-extrabold text-[#0A2540]">
                        {formatCurrency(inv.amount, inv.currency)}
                      </p>
                      <div className="flex items-center gap-2">
                        {inv.pdfFilename && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const r = await fetchWithAuth(`/api/portal/invoices/${inv.id}/download`);
                              const blob = await r.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url; a.download = `Invoice-${inv.invoiceNumber ?? inv.id}.pdf`; a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="p-2 border border-border rounded-lg text-muted-foreground hover:text-[#0078D4] hover:border-[#0078D4]/30 transition-colors"
                            title="Download PDF"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                          </button>
                        )}
                        {canPay && (
                          <button
                            onClick={(e) => { e.stopPropagation(); void handlePay(inv); }}
                            disabled={paying === inv.id}
                            className="flex items-center gap-1.5 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors disabled:opacity-60"
                          >
                            {paying === inv.id ? (
                              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                              </svg>
                            )}
                            Pay Now
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Subscription Receipts ─────────────────────────────────────── */}
        {(receiptsLoading || stripeReceipts.length > 0) && (
          <div className="mt-8">
            <h2 className="text-base font-bold text-[#0A2540] mb-3">Subscription Receipts</h2>
            {receiptsLoading ? (
              <div className="bg-white border border-border rounded-xl p-6 flex items-center gap-3 text-muted-foreground text-sm">
                <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                Loading receipts…
              </div>
            ) : (
              <div className="bg-white border border-border rounded-xl overflow-hidden">
                <div className="divide-y divide-border">
                  {stripeReceipts.map(receipt => {
                    const isPaid = receipt.status === "paid";
                    const statusClasses = isPaid
                      ? "bg-green-100 text-green-700 border-green-200"
                      : receipt.status === "open"
                        ? "bg-yellow-100 text-yellow-700 border-yellow-200"
                        : "bg-gray-100 text-gray-500 border-gray-200";
                    const statusLabel = isPaid ? "Paid" : receipt.status.charAt(0).toUpperCase() + receipt.status.slice(1);
                    return (
                      <div key={receipt.id} className="px-5 py-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                        <div className="w-10 h-10 rounded-xl bg-[#00B4D8]/10 flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <p className="text-sm font-bold text-[#0A2540]">
                              {receipt.number ?? receipt.id}
                            </p>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusClasses}`}>
                              {statusLabel}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {new Date(receipt.date * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
                          <p className="text-base font-extrabold text-[#0A2540]">
                            {formatCurrency(receipt.amount / 100, receipt.currency)}
                          </p>
                          {receipt.invoicePdf && (
                            <a
                              href={receipt.invoicePdf}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 border border-border rounded-lg text-muted-foreground hover:text-[#0078D4] hover:border-[#0078D4]/30 transition-colors"
                              title="Download PDF"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 bg-[#F7F9FC] border border-border rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <p className="text-xs text-muted-foreground">Payments are processed securely via Stripe. Your card details are never stored on our servers.</p>
        </div>
      </div>

      {cancelTarget && (
        <CancelDialog
          sub={cancelTarget}
          onConfirm={() => void handleCancelConfirm()}
          onClose={() => setCancelTarget(null)}
          loading={cancelling}
        />
      )}
    </PortalLayout>
  );
}
