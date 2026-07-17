import { CreditCard, DollarSign, AlertCircle } from "lucide-react";
import type { Invoice } from "./billing-types";

function formatCurrency(amount: string | number, currency: string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(num);
}

export function BillingSummaryCards({ invoices }: { invoices: Invoice[] }) {
  const invoicesArray = Array.isArray(invoices) ? invoices : [];
  
  const totalDue = invoicesArray
    .filter((i) => i.status === "due" || i.status === "overdue")
    .reduce((sum, i) => sum + parseFloat(i.amount), 0);
  const totalPaid = invoicesArray.filter((i) => i.status === "paid").reduce((sum, i) => sum + parseFloat(i.amount), 0);
  const totalInvoiced = invoicesArray.reduce((s, i) => s + parseFloat(i.amount), 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Total Invoiced */}
      <div className="bg-white/5 dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-slate-800/50 rounded-2xl p-5 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
        <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
          <CreditCard className="w-6 h-6 text-blue-500" />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Total Invoiced</p>
          <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">
            {formatCurrency(totalInvoiced, "usd")}
          </p>
        </div>
      </div>

      {/* Amount Paid */}
      <div className="bg-white/5 dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-slate-800/50 rounded-2xl p-5 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
        <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
          <DollarSign className="w-6 h-6 text-emerald-500" />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Amount Paid</p>
          <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(totalPaid, "usd")}
          </p>
        </div>
      </div>

      {/* Outstanding */}
      <div className="bg-white/5 dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-slate-800/50 rounded-2xl p-5 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${totalDue > 0 ? "bg-rose-500/10" : "bg-slate-500/10"}`}>
          <AlertCircle className={`w-6 h-6 ${totalDue > 0 ? "text-rose-500" : "text-slate-500"}`} />
        </div>
        <div className="z-10">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Outstanding</p>
          <p className={`text-2xl font-extrabold ${totalDue > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-800 dark:text-slate-100"}`}>
            {formatCurrency(totalDue, "usd")}
          </p>
        </div>
        {totalDue > 0 && (
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
        )}
      </div>
    </div>
  );
}
