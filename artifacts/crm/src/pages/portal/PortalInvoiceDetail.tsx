import { useEffect, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
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
  projectId: number | null;
  couponCode: string | null;
  discountAmount: string | null;
}

interface Project {
  id: number;
  title: string;
}

interface ClientInfo {
  name: string | null;
  company: string | null;
  phone: string | null;
  address: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
}

interface WizardOption {
  id: string;
  label: string;
  description?: string;
  priceAdjustment: number;
}

interface WizardStep {
  id: string;
  title: string;
  options: WizardOption[];
}

interface WizardSelection {
  stepId: string;
  optionId: string;
}

interface ContractSummary {
  id: number;
  serviceId: number;
  serviceName: string;
  signedAt: string;
  signerName: string | null;
  contractVersion: string;
  finalPrice: string | null;
  wizardSelections: WizardSelection[] | null;
  orderWorkflow: WizardStep[] | null;
}

interface InvoiceDetailData {
  invoice: Invoice;
  project: Project | null;
  contracts: ContractSummary[];
  client: ClientInfo | null;
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

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ""}`} />;
}

const BILL_FROM = {
  name: "Shane McCaw Consulting",
  tagline: "Lead Microsoft 365 Architect",
  email: "shane@shanemccaw.com",
  website: "shanemccawconsulting.com",
};

export default function PortalInvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [data, setData] = useState<InvoiceDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchWithAuth(`/api/portal/invoices/${id}`)
      .then(async r => {
        if (r.status === 404) { setNotFound(true); return; }
        const d = await r.json() as InvoiceDetailData;
        setData(d);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [fetchWithAuth, id]);

  const handlePay = async () => {
    if (!data || !id) return;
    setPaying(true);
    setPayError(null);
    try {
      const res = await fetchWithAuth(`/api/portal/invoices/${id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: window.location.origin }),
      });
      if (res.ok) {
        const d = await res.json() as { url: string };
        window.location.href = d.url;
      } else {
        const err = await res.json() as { error: string };
        setPayError(err.error ?? "Could not start payment. Please try again.");
      }
    } catch {
      setPayError("Network error. Please try again.");
    } finally {
      setPaying(false);
    }
  };

  const handleDownload = async () => {
    if (!id || !data?.invoice.pdfFilename) return;
    const r = await fetchWithAuth(`/api/portal/invoices/${id}/download`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Invoice-${data.invoice.invoiceNumber ?? id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (notFound) {
    return (
      <PortalLayout>
        <div className="px-6 py-8 max-w-3xl mx-auto text-center">
          <p className="text-muted-foreground">Invoice not found.</p>
          <Link href="/portal/billing">
            <span className="mt-4 inline-block text-[#0078D4] text-sm font-semibold hover:underline">← Back to Billing</span>
          </Link>
        </div>
      </PortalLayout>
    );
  }

  const inv = data?.invoice;
  const config = inv ? (STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.draft) : null;
  const canPay = inv?.status === "due" || inv?.status === "overdue";
  const contract = data?.contracts[0] ?? null;

  // Build line items from wizard selections
  const lineItems: Array<{ stepTitle: string; optionLabel: string; adjustment: number }> = [];
  if (contract?.wizardSelections && contract.orderWorkflow) {
    for (const sel of contract.wizardSelections) {
      const step = contract.orderWorkflow.find(s => s.id === sel.stepId);
      const option = step?.options.find(o => o.id === sel.optionId);
      if (step && option && option.priceAdjustment !== 0) {
        lineItems.push({ stepTitle: step.title, optionLabel: option.label, adjustment: option.priceAdjustment });
      }
    }
  }

  const totalAmount = inv ? parseFloat(inv.amount) : 0;
  const totalAdj = lineItems.reduce((sum, li) => sum + li.adjustment, 0);
  const baseAmount = totalAmount - totalAdj;
  const serviceName = contract?.serviceName ?? inv?.description ?? "Consulting Services";

  // Build client address string parts
  const client = data?.client ?? null;
  const addressParts: string[] = [];
  if (client?.address) addressParts.push(client.address);
  const cityStateZip = [client?.addressCity, client?.addressState, client?.addressZip].filter(Boolean).join(", ");
  if (cityStateZip) addressParts.push(cityStateZip);

  return (
    <PortalLayout>
      <div className="px-6 py-8 max-w-3xl mx-auto">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/portal/billing">
            <span className="hover:text-[#0078D4] cursor-pointer">Billing</span>
          </Link>
          <span>/</span>
          <span className="text-[#0A2540] font-medium">
            {loading ? "Loading…" : `Invoice ${inv?.invoiceNumber ?? id}`}
          </span>
        </nav>

        {/* Header */}
        <div className="bg-white border border-border rounded-2xl p-6 mb-5 shadow-sm">
          {loading ? (
            <div className="space-y-3">
              <SkeletonBlock className="h-6 w-48" />
              <SkeletonBlock className="h-4 w-32" />
              <SkeletonBlock className="h-4 w-64" />
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 flex-wrap mb-2">
                  <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <h1 className="text-xl font-extrabold text-[#0A2540]">{inv!.invoiceNumber}</h1>
                    {config && (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${config.classes}`}>
                        {config.label}
                      </span>
                    )}
                  </div>
                </div>
                {inv!.description && (
                  <p className="text-sm text-muted-foreground mt-1">{inv!.description}</p>
                )}
                {data?.project && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Project: <span className="font-semibold text-[#0A2540]">{data.project.title}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {inv!.pdfFilename && (
                  <button
                    onClick={() => void handleDownload()}
                    className="flex items-center gap-1.5 border border-border text-sm font-semibold px-3 py-2 rounded-lg hover:border-[#0078D4]/40 hover:text-[#0078D4] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download PDF
                  </button>
                )}
                {canPay && (
                  <button
                    onClick={() => void handlePay()}
                    disabled={paying}
                    className="flex items-center gap-1.5 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-60 transition-colors"
                  >
                    {paying ? (
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
          )}

          {payError && (
            <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{payError}</div>
          )}
        </div>

        {/* Bill From / Bill To */}
        <div className="bg-white border border-border rounded-2xl p-6 mb-5 shadow-sm">
          {loading ? (
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="h-4 w-40" />
                <SkeletonBlock className="h-3 w-32" />
              </div>
              <div className="space-y-2">
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="h-4 w-40" />
                <SkeletonBlock className="h-3 w-32" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Bill From */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Bill From</p>
                <p className="text-sm font-bold text-[#0A2540]">{BILL_FROM.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{BILL_FROM.tagline}</p>
                <p className="text-xs text-[#0078D4] mt-1">{BILL_FROM.email}</p>
                <p className="text-xs text-muted-foreground">{BILL_FROM.website}</p>
              </div>

              {/* Bill To */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Bill To</p>
                {client?.name && <p className="text-sm font-bold text-[#0A2540]">{client.name}</p>}
                {client?.company && <p className="text-xs text-muted-foreground mt-0.5">{client.company}</p>}
                {addressParts.map((line, i) => (
                  <p key={i} className="text-xs text-muted-foreground">{line}</p>
                ))}
                {client?.phone && <p className="text-xs text-muted-foreground mt-1">{client.phone}</p>}
                {!client?.name && !client?.company && !client?.phone && addressParts.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No contact details on file.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Amount summary */}
        <div className="bg-white border border-border rounded-2xl p-6 mb-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#0A2540] mb-4">Amount Summary</h2>
          {loading ? (
            <div className="space-y-3">
              <SkeletonBlock className="h-4 w-full" />
              <SkeletonBlock className="h-6 w-32" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Issued</p>
                  <p className="text-sm font-semibold text-[#0A2540]">{formatDate(inv!.createdAt)}</p>
                </div>
                {inv!.dueDate && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Due Date</p>
                    <p className="text-sm font-semibold text-[#0A2540]">{formatDate(inv!.dueDate)}</p>
                  </div>
                )}
                {inv!.paidAt && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Paid</p>
                    <p className="text-sm font-semibold text-green-700">{formatDate(inv!.paidAt)}</p>
                  </div>
                )}
              </div>

              {/* Line items table */}
              <div className="border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-[#F7F9FC] border-b border-border flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <span>Description</span>
                  <span>Amount</span>
                </div>

                {/* Base service row */}
                <div className="px-4 py-3 flex items-center justify-between border-b border-border/60">
                  <p className="text-sm font-semibold text-[#0A2540]">{serviceName}</p>
                  <p className="text-sm font-semibold text-[#0A2540]">{formatCurrency(baseAmount, inv!.currency)}</p>
                </div>

                {/* Wizard add-on sub-rows */}
                {lineItems.map((li, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-center justify-between border-b border-border/40 bg-[#F7F9FC]/50">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-muted-foreground/50 select-none ml-3">↳</span>
                      <div className="min-w-0">
                        <span className="text-xs text-muted-foreground">{li.stepTitle}: </span>
                        <span className="text-xs font-medium text-[#0A2540]">{li.optionLabel}</span>
                      </div>
                    </div>
                    <span className={`text-xs font-semibold flex-shrink-0 ml-4 ${li.adjustment > 0 ? "text-[#0078D4]" : "text-green-700"}`}>
                      {li.adjustment > 0
                        ? `+${formatCurrency(li.adjustment, inv!.currency)}`
                        : `−${formatCurrency(Math.abs(li.adjustment), inv!.currency)}`}
                    </span>
                  </div>
                ))}

                {/* Coupon / discount row */}
                {inv!.couponCode && (
                  <div className="px-4 py-2.5 flex items-center justify-between border-b border-border/40 bg-green-50/50">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-muted-foreground/50 select-none ml-3">↳</span>
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Promo code:</span>
                        <span className="font-mono text-xs font-semibold text-green-700 bg-green-100 border border-green-200 px-1.5 py-0.5 rounded">
                          {inv!.couponCode}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-green-700 flex-shrink-0 ml-4">
                      {inv!.discountAmount
                        ? `−${formatCurrency(inv!.discountAmount, inv!.currency)}`
                        : "Discount applied"}
                    </span>
                  </div>
                )}

                {/* Total row */}
                <div className="px-4 py-3 bg-[#F7F9FC] border-t border-border flex items-center justify-between">
                  <p className="text-sm font-bold text-[#0A2540]">Total</p>
                  <p className="text-base font-extrabold text-[#0A2540]">{formatCurrency(inv!.amount, inv!.currency)}</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Order Configuration */}
        {!loading && contract && contract.wizardSelections && contract.wizardSelections.length > 0 && contract.orderWorkflow && (
          <div className="bg-white border border-border rounded-2xl p-6 mb-5 shadow-sm">
            <h2 className="text-sm font-bold text-[#0A2540] mb-4">Order Configuration</h2>
            <div className="divide-y divide-border">
              {contract.wizardSelections.map((sel) => {
                const step = contract.orderWorkflow!.find(s => s.id === sel.stepId);
                const option = step?.options.find(o => o.id === sel.optionId);
                if (!step || !option) return null;
                const adj = option.priceAdjustment ?? 0;
                const adjLabel = adj === 0
                  ? "Included"
                  : adj > 0
                  ? `+${formatCurrency(adj, "usd")}`
                  : `−${formatCurrency(Math.abs(adj), "usd")}`;
                return (
                  <div key={sel.stepId} className="flex items-center justify-between py-3 gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{step.title}</p>
                      <p className="text-sm font-medium text-[#0A2540]">{option.label}</p>
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                      adj === 0
                        ? "bg-gray-100 text-gray-500"
                        : adj > 0
                        ? "bg-blue-50 text-[#0078D4]"
                        : "bg-green-50 text-green-700"
                    }`}>
                      {adjLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Governing contract */}
        <div className="bg-white border border-border rounded-2xl p-6 mb-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#0A2540] mb-4">Governing Contract</h2>
          {loading ? (
            <div className="space-y-2">
              <SkeletonBlock className="h-4 w-48" />
              <SkeletonBlock className="h-4 w-32" />
            </div>
          ) : contract ? (
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#00B4D8]/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#0A2540]">{contract.serviceName}</p>
                <div className="flex items-center gap-3 flex-wrap mt-1 text-xs text-muted-foreground">
                  <span>Signed {formatDate(contract.signedAt)}</span>
                  {contract.signerName && <span>by {contract.signerName}</span>}
                  {contract.finalPrice && (
                    <span className="font-semibold text-[#0A2540]">
                      {formatCurrency(contract.finalPrice, "usd")}
                    </span>
                  )}
                </div>
              </div>
              <Link href={`/portal/billing/contracts/${contract.id}`}>
                <span className="flex items-center gap-1 text-sm font-semibold text-[#0078D4] hover:underline flex-shrink-0 cursor-pointer">
                  View Contract
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              No contract on file for this invoice.
            </div>
          )}
        </div>

        <div className="mt-2 bg-[#F7F9FC] border border-border rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <p className="text-xs text-muted-foreground">Payments are processed securely via Stripe. Your card details are never stored on our servers.</p>
        </div>
      </div>
    </PortalLayout>
  );
}
