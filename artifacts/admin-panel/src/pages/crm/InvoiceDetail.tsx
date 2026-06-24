import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface InvoiceDetail {
  id: number;
  clientUserId: number;
  projectId: number | null;
  invoiceNumber: string;
  description: string | null;
  amount: string;
  currency: string;
  status: "draft" | "due" | "paid" | "overdue";
  dueDate: string | null;
  paidAt: string | null;
  pdfFilename: string | null;
  sharepointFileUrl: string | null;
  stripeSessionId: string | null;
  couponCode: string | null;
  discountAmount: string | null;
  invoiceType: "instant" | "retainer";
  stripeInvoiceId: string | null;
  billingCycleStart: string | null;
  billingCycleEnd: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: number; name: string | null; email: string; company: string | null } | null;
  project: { id: number; title: string; status: string; projectType: string } | null;
  contract: {
    id: number;
    contractVersion: string;
    signedAt: string;
    serviceId: number;
    projectId: number | null;
    stripeSessionId: string | null;
    pdfFilename: string | null;
  } | null;
  agingBucket: string | null;
}

interface AiSummary {
  churnProbability: "low" | "medium" | "high" | null;
  revenueImpact: string;
  serviceProfitabilityInsight: string;
  clientPurchaseBehavior: string;
  recommendedActions: string[];
}

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  due: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  overdue: "bg-red-500/15 text-red-400 border-red-500/20",
  draft: "bg-[#30363D]/50 text-[#7D8590] border-[#30363D]",
};

const CHURN_COLORS: Record<string, string> = {
  low: "text-emerald-400",
  medium: "text-amber-400",
  high: "text-red-400",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 bg-[#1C2128] border-b border-border">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-sm text-[#E6EDF3] ${mono ? "font-mono text-xs" : ""}`}>{value ?? "—"}</p>
    </div>
  );
}

function fmt(amount: string | null, currency = "usd") {
  if (!amount) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(parseFloat(amount));
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = Number(params.id);
  const [, navigate] = useLocation();
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);

  useEffect(() => {
    if (!invoiceId) return;
    setLoading(true);
    fetchWithAuth(`/api/admin/invoices/${invoiceId}`)
      .then(async r => {
        if (!r.ok) throw new Error("Invoice not found");
        setInvoice(await r.json() as InvoiceDetail);
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [invoiceId, fetchWithAuth]);

  const handleStatusChange = async (status: string) => {
    if (!invoice) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setInvoice(prev => prev ? { ...prev, status: status as InvoiceDetail["status"], paidAt: status === "paid" ? new Date().toISOString() : prev.paidAt } : prev);
        toast({ title: "Status updated", description: `Invoice marked as ${status}` });
      } else {
        toast({ title: "Error", description: "Failed to update status", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const generateAiSummary = async () => {
    if (!invoice) return;
    setAiLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/invoices/${invoice.id}/ai-summary`, { method: "POST" });
      if (res.ok) {
        setAiSummary(await res.json() as AiSummary);
      } else {
        const body = await res.json() as { error?: string };
        toast({ title: "AI Summary failed", description: body.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "AI Summary failed", description: "Network error", variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  const pdfDownloadUrl = invoice?.pdfFilename
    ? `/api/admin/invoices/${invoice.id}/pdf`
    : invoice?.sharepointFileUrl ?? null;

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-24">
        <div className="w-7 h-7 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
          <p className="text-red-400 font-semibold mb-2">{error ?? "Invoice not found"}</p>
          <button onClick={() => navigate("/crm/invoices")}
            className="text-sm text-[#0078D4] hover:underline">← Back to Invoices</button>
        </div>
      </div>
    );
  }

  const netAmount = parseFloat(invoice.amount) - parseFloat(invoice.discountAmount ?? "0");

  return (
    <div className="p-4 sm:p-6 max-w-[1100px] space-y-5">
      {/* Nav */}
      <button onClick={() => navigate("/crm/invoices")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#E6EDF3] transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Invoices
      </button>

      {/* Header */}
      <div className="bg-[#161B22] border border-border rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-[#E6EDF3]">{invoice.invoiceNumber}</h1>
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${STATUS_COLORS[invoice.status]}`}>
                {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
              </span>
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${invoice.invoiceType === "retainer" ? "bg-purple-500/15 text-purple-400" : "bg-[#0078D4]/15 text-[#0078D4]"}`}>
                {invoice.invoiceType === "retainer" ? "Retainer" : "Instant"}
              </span>
              {invoice.agingBucket && (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-500/15 text-red-400">
                  {invoice.agingBucket} overdue
                </span>
              )}
            </div>
            {invoice.description && (
              <p className="text-sm text-muted-foreground">{invoice.description}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <select
              value={invoice.status}
              onChange={e => void handleStatusChange(e.target.value)}
              disabled={saving}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-[#1C2128] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4] disabled:opacity-60"
            >
              <option value="draft">Draft</option>
              <option value="due">Due</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
            </select>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-border">
          <Field label="Created" value={new Date(invoice.createdAt).toLocaleDateString()} />
          <Field label="Due Date" value={invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—"} />
          <Field label="Paid On" value={invoice.paidAt ? new Date(invoice.paidAt).toLocaleDateString() : "—"} />
          <Field label="Last Updated" value={new Date(invoice.updatedAt).toLocaleDateString()} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Amount Breakdown */}
        <Section title="Amount Breakdown">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Gross Amount</span>
              <span className="text-sm font-semibold text-[#E6EDF3]">{fmt(invoice.amount, invoice.currency)}</span>
            </div>
            {invoice.couponCode && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  Coupon
                  <span className="text-[10px] font-bold bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded">
                    {invoice.couponCode}
                  </span>
                </span>
                <span className="text-sm font-semibold text-emerald-400">
                  -{fmt(invoice.discountAmount ?? "0", invoice.currency)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-border">
              <span className="text-sm font-bold text-[#E6EDF3]">Net Amount</span>
              <span className="text-lg font-bold text-[#E6EDF3]">{fmt(String(netAmount), invoice.currency)}</span>
            </div>
            <div className="pt-1">
              <Field label="Currency" value={invoice.currency.toUpperCase()} />
            </div>
          </div>
        </Section>

        {/* Linked Entities */}
        <Section title="Linked Entities">
          <div className="space-y-4">
            {invoice.client && (
              <div
                onClick={() => navigate(`/crm/clients/${invoice.client!.id}`)}
                className="flex items-center gap-3 p-3 rounded-lg bg-[#1C2128] hover:bg-[#21262D] transition-colors cursor-pointer border border-transparent hover:border-[#0078D4]/30"
              >
                <div className="w-8 h-8 rounded-full bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#E6EDF3] truncate">{invoice.client.name ?? invoice.client.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{invoice.client.company ?? invoice.client.email}</p>
                </div>
                <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </div>
            )}
            {invoice.project && (
              <div
                onClick={() => navigate(`/crm/projects/${invoice.project!.id}`)}
                className="flex items-center gap-3 p-3 rounded-lg bg-[#1C2128] hover:bg-[#21262D] transition-colors cursor-pointer border border-transparent hover:border-[#0078D4]/30"
              >
                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#E6EDF3] truncate">{invoice.project.title}</p>
                  <p className="text-xs text-muted-foreground capitalize">{invoice.project.status.replace("_", " ")} · {invoice.project.projectType}</p>
                </div>
                <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </div>
            )}
            {invoice.contract && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-[#1C2128] border border-border">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#E6EDF3]">Contract {invoice.contract.contractVersion}</p>
                  <p className="text-xs text-muted-foreground">Signed {new Date(invoice.contract.signedAt).toLocaleDateString()}</p>
                </div>
              </div>
            )}
            {!invoice.client && !invoice.project && !invoice.contract && (
              <p className="text-sm text-muted-foreground text-center py-4">No linked entities</p>
            )}
          </div>
        </Section>
      </div>

      {/* Retainer section */}
      {invoice.invoiceType === "retainer" && (
        <Section title="Retainer / Subscription Details">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Stripe Subscription" value={invoice.stripeSubscriptionId} mono />
            <Field label="Stripe Invoice ID" value={invoice.stripeInvoiceId} mono />
            <Field label="Cycle Start" value={invoice.billingCycleStart ? new Date(invoice.billingCycleStart).toLocaleDateString() : null} />
            <Field label="Cycle End" value={invoice.billingCycleEnd ? new Date(invoice.billingCycleEnd).toLocaleDateString() : null} />
          </div>
        </Section>
      )}

      {/* IDs & references */}
      <Section title="References">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field label="Invoice ID" value={`#${invoice.id}`} />
          <Field label="Stripe Session" value={invoice.stripeSessionId} mono />
          {invoice.sharepointFileUrl && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">SharePoint</p>
              <a href={invoice.sharepointFileUrl} target="_blank" rel="noreferrer"
                className="text-xs text-[#0078D4] hover:underline truncate block">View in SharePoint ↗</a>
            </div>
          )}
        </div>
      </Section>

      {/* PDF Viewer */}
      {(invoice.pdfFilename || invoice.sharepointFileUrl) && (
        <Section title="Invoice PDF">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPdfViewerOpen(v => !v)}
              className="flex items-center gap-2 border border-border rounded-lg px-4 py-2 text-sm font-medium text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
              {pdfViewerOpen ? "Hide PDF" : "View PDF"}
            </button>
            {pdfDownloadUrl && (
              <a href={pdfDownloadUrl} download target="_blank" rel="noreferrer"
                className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download
              </a>
            )}
          </div>
          {pdfViewerOpen && (
            <div className="mt-4 rounded-xl overflow-hidden border border-border h-[600px]">
              {invoice.sharepointFileUrl ? (
                <iframe src={invoice.sharepointFileUrl} className="w-full h-full" title="Invoice PDF" />
              ) : pdfDownloadUrl ? (
                <iframe src={pdfDownloadUrl} className="w-full h-full" title="Invoice PDF" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                  PDF not available for inline view.
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {/* AI Summary */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-[#1C2128] border-b border-border flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">AI Summary</h3>
          <button
            onClick={() => void generateAiSummary()}
            disabled={aiLoading}
            className="flex items-center gap-2 text-xs font-semibold text-white bg-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-60 transition-colors"
          >
            {aiLoading ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                {aiSummary ? "Regenerate" : "Generate Summary"}
              </>
            )}
          </button>
        </div>

        <div className="p-5">
          {!aiSummary && !aiLoading && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Click "Generate Summary" to get a Claude-powered analysis of this invoice — revenue impact, client behaviour, and recommended next actions.
            </p>
          )}
          {aiLoading && (
            <div className="flex items-center gap-3 py-8 justify-center">
              <div className="w-5 h-5 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">Analysing invoice with Claude…</span>
            </div>
          )}
          {aiSummary && !aiLoading && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {invoice.invoiceType === "retainer" && aiSummary.churnProbability && (
                  <div className="bg-[#1C2128] rounded-xl p-4 border border-border">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Churn Risk</p>
                    <p className={`text-xl font-bold ${CHURN_COLORS[aiSummary.churnProbability] ?? "text-[#E6EDF3]"}`}>
                      {aiSummary.churnProbability.charAt(0).toUpperCase() + aiSummary.churnProbability.slice(1)}
                    </p>
                  </div>
                )}
                <div className="bg-[#1C2128] rounded-xl p-4 border border-border">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Revenue Impact</p>
                  <p className="text-sm text-[#E6EDF3]">{aiSummary.revenueImpact}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-[#1C2128] rounded-xl p-4 border border-border">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Service Profitability</p>
                  <p className="text-sm text-[#E6EDF3]">{aiSummary.serviceProfitabilityInsight}</p>
                </div>
                <div className="bg-[#1C2128] rounded-xl p-4 border border-border">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Client Behaviour</p>
                  <p className="text-sm text-[#E6EDF3]">{aiSummary.clientPurchaseBehavior}</p>
                </div>
              </div>
              {aiSummary.recommendedActions && aiSummary.recommendedActions.length > 0 && (
                <div className="bg-[#1C2128] rounded-xl p-4 border border-border">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Recommended Actions</p>
                  <ul className="space-y-2">
                    {aiSummary.recommendedActions.map((action, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-[#0078D4]/20 text-[#0078D4] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                        <span className="text-sm text-[#E6EDF3]">{action}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
