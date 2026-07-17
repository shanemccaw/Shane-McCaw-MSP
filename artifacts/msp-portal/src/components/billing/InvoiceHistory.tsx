import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Download, Loader2, FileText, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import type { Invoice, StripeReceipt } from "./billing-types";

function formatCurrency(amount: string | number, currency: string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(num);
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  paid: { label: "Paid", bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400" },
  due: { label: "Due", bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-500" },
  overdue: { label: "Overdue", bg: "bg-rose-500/10", text: "text-rose-600 dark:text-rose-400" },
  draft: { label: "Draft", bg: "bg-slate-500/10", text: "text-slate-600 dark:text-slate-400" },
};

export function InvoiceHistory({
  invoices,
  stripeReceipts,
  loading,
  receiptsLoading,
  isPlatformBilled,
  fetchWithAuth,
  onPay,
  payingId,
}: {
  invoices: Invoice[];
  stripeReceipts: StripeReceipt[];
  loading: boolean;
  receiptsLoading: boolean;
  isPlatformBilled: boolean;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  onPay: (inv: Invoice) => void;
  payingId: number | null;
}) {
  const invoicesArray = Array.isArray(invoices) ? invoices : [];
  const receiptsArray = Array.isArray(stripeReceipts) ? stripeReceipts : [];
  const showReceipts = isPlatformBilled && receiptsArray.length > 0;
  
  if (loading && receiptsLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse bg-white/5 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 rounded-2xl h-20" />
        ))}
      </div>
    );
  }

  if (invoicesArray.length === 0 && (!isPlatformBilled || receiptsArray.length === 0)) {
    return (
      <div className="bg-white/5 dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-slate-800/50 rounded-2xl p-12 text-center flex flex-col items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
          <FileText className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">No Invoice History</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
          You don't have any invoices or receipts generated yet. Future billing statements will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white/5 dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-slate-800/50 rounded-2xl overflow-hidden shadow-sm">
      <div className="divide-y divide-slate-200 dark:divide-slate-800/50">
        
        {/* Render Invoices */}
        {invoicesArray.map((inv) => {
          const config = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.draft;
          const canPay = inv.status === "due" || inv.status === "overdue";
          
          return (
            <div key={`inv-${inv.id}`} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${inv.status === 'paid' ? 'bg-emerald-500/10' : 'bg-blue-500/10'}`}>
                  {inv.status === 'paid' ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <FileText className="w-5 h-5 text-blue-500" />}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap mb-1">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{inv.invoiceNumber}</p>
                    <Badge variant="secondary" className={`${config.bg} ${config.text} border-transparent font-semibold`}>
                      {config.label}
                    </Badge>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    {inv.description && <span className="truncate max-w-[200px]">{inv.description}</span>}
                    
                    {inv.dueDate && inv.status !== "paid" && (
                      <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Due {new Date(inv.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                    
                    {inv.paidAt && (
                      <span className="text-emerald-600 dark:text-emerald-500 font-medium">
                        Paid {new Date(inv.paidAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-5 flex-shrink-0 mt-2 sm:mt-0 pl-14 sm:pl-0">
                <p className="text-base font-extrabold text-slate-800 dark:text-slate-200">
                  {formatCurrency(inv.amount, inv.currency)}
                </p>
                <div className="flex items-center gap-2">
                  {inv.pdfFilename && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
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
                      <Download className="w-4 h-4 text-slate-500" />
                    </Button>
                  )}
                  {canPay && (
                    <Button
                      size="sm"
                      className="rounded-full h-8 px-4"
                      onClick={() => void onPay(inv)}
                      disabled={payingId === inv.id}
                    >
                      {payingId === inv.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                      ) : (
                        <CreditCard className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      Pay Now
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Render Stripe Receipts if applicable */}
        {showReceipts && receiptsArray.map((receipt) => {
          const isPaid = receipt.status === "paid";
          const bg = isPaid ? "bg-emerald-500/10" : receipt.status === "open" ? "bg-amber-500/10" : "bg-slate-500/10";
          const text = isPaid ? "text-emerald-600 dark:text-emerald-400" : receipt.status === "open" ? "text-amber-600 dark:text-amber-500" : "text-slate-600 dark:text-slate-400";
          const statusLabel = isPaid ? "Paid" : receipt.status.charAt(0).toUpperCase() + receipt.status.slice(1);
          
          return (
            <div key={`rcpt-${receipt.id}`} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                  <RefreshCw className="w-5 h-5 text-purple-500" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap mb-1">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Receipt {receipt.number ?? receipt.id.slice(0, 8)}</p>
                    <Badge variant="secondary" className={`${bg} ${text} border-transparent font-semibold`}>
                      {statusLabel}
                    </Badge>
                  </div>
                  
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {new Date(receipt.date * 1000).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-5 flex-shrink-0 mt-2 sm:mt-0 pl-14 sm:pl-0">
                <p className="text-base font-extrabold text-slate-800 dark:text-slate-200">
                  {formatCurrency(receipt.amount / 100, receipt.currency)}
                </p>
                <div className="flex items-center gap-2">
                  {receipt.invoicePdf && (
                    <a href={receipt.invoicePdf} target="_blank" rel="noopener noreferrer" title="Download PDF">
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700">
                        <Download className="w-4 h-4 text-slate-500" />
                      </Button>
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
