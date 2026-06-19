import { useEffect, useState } from "react";
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

const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  paid: { label: "Paid", classes: "bg-green-100 text-green-700 border-green-200" },
  due: { label: "Due", classes: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  overdue: { label: "Overdue", classes: "bg-red-100 text-red-700 border-red-200" },
  draft: { label: "Draft", classes: "bg-gray-100 text-gray-500 border-gray-200" },
};

function formatCurrency(amount: string, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(parseFloat(amount));
}

export default function PortalBilling() {
  const { fetchWithAuth } = useAuth();
  const [location] = useLocation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPayingId] = useState<number | null>(null);
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

  const totalDue = invoices.filter(i => i.status === "due" || i.status === "overdue")
    .reduce((sum, i) => sum + parseFloat(i.amount), 0);
  const totalPaid = invoices.filter(i => i.status === "paid")
    .reduce((sum, i) => sum + parseFloat(i.amount), 0);

  return (
    <PortalLayout>
      <div className="px-6 py-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-[#0A2540]">Billing & Invoices</h1>
          <p className="text-muted-foreground text-sm mt-1">View and pay your invoices securely online.</p>
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

        {/* Summary cards */}
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
                  <div key={inv.id} className="px-5 py-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                    <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-sm font-bold text-[#0A2540]">{inv.invoiceNumber}</p>
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
                            onClick={async () => {
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
                            onClick={() => void handlePay(inv)}
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

        <div className="mt-6 bg-[#F7F9FC] border border-border rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <p className="text-xs text-muted-foreground">Payments are processed securely via Stripe. Your card details are never stored on our servers.</p>
        </div>
      </div>
    </PortalLayout>
  );
}
