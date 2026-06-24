import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

interface Client {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
}

interface Invoice {
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
  stripeSessionId: string | null;
  couponCode: string | null;
  discountAmount: string | null;
  invoiceType: "instant" | "retainer";
  stripeInvoiceId: string | null;
  billingCycleStart: string | null;
  billingCycleEnd: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  clientName: string | null;
  clientEmail: string | null;
  clientCompany: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-400",
  due: "bg-amber-500/15 text-amber-400",
  overdue: "bg-red-500/15 text-red-400",
  draft: "bg-[#30363D]/50 text-[#7D8590]",
};

const TYPE_COLORS: Record<string, string> = {
  instant: "bg-[#0078D4]/15 text-[#0078D4]",
  retainer: "bg-purple-500/15 text-purple-400",
};

function fmt(amount: string, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(parseFloat(amount));
}

type SortKey = "createdAt" | "amount" | "dueDate" | "status" | "invoiceNumber";

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <span className="text-[#484F58] ml-1">↕</span>;
  return <span className="text-[#0078D4] ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
}

export default function InvoicesPage() {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    clientUserId: "", invoiceNumber: "", description: "", amount: "",
    currency: "usd", dueDate: "", invoiceType: "instant",
  });
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterType !== "all") params.set("type", filterType);
    if (filterStatus !== "all") params.set("status", filterStatus);
    params.set("sortBy", sortKey);
    params.set("sortDir", sortDir);

    const [invRes, clientRes] = await Promise.all([
      fetchWithAuth(`/api/admin/invoices?${params.toString()}`),
      fetchWithAuth("/api/admin/clients"),
    ]);
    if (invRes.ok) setInvoices(await invRes.json() as Invoice[]);
    if (clientRes.ok) setClients(await clientRes.json() as Client[]);
    setLoading(false);
  }, [fetchWithAuth, filterType, filterStatus, sortKey, sortDir]);

  useEffect(() => { void load(); }, [load]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const clientDisplayName = (inv: Invoice) => {
    if (inv.clientName) return inv.clientName;
    const c = clients.find(c => c.id === inv.clientUserId);
    return c ? (c.name ?? c.email) : String(inv.clientUserId);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clientUserId || !form.invoiceNumber || !form.amount) {
      setError("Client, invoice number, and amount are required.");
      return;
    }
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });
      if (pdfFile) fd.append("pdf", pdfFile);
      const res = await fetchWithAuth("/api/admin/invoices", { method: "POST", body: fd });
      if (!res.ok) {
        setError((await res.json() as { error: string }).error);
      } else {
        setShowForm(false);
        setForm({ clientUserId: "", invoiceNumber: "", description: "", amount: "", currency: "usd", dueDate: "", invoiceType: "instant" });
        setPdfFile(null);
        await load();
      }
    } finally {
      setUploading(false);
    }
  };

  const Th = ({ label, sortable, sk }: { label: string; sortable?: SortKey; sk?: SortKey }) => (
    <th
      className={`text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground select-none ${sortable ? "cursor-pointer hover:text-[#E6EDF3] transition-colors" : ""}`}
      onClick={sortable ? () => handleSort(sortable) : undefined}
    >
      {label}{sortable && <SortIcon active={sortKey === sortable} dir={sortDir} />}
    </th>
  );

  return (
    <div className="p-4 sm:p-6 max-w-[1300px]">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage client invoices and billing.</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setError(""); }}
          className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          New Invoice
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-[#1C2128] border border-border rounded-xl p-5 mb-5">
          <h3 className="text-sm font-bold text-[#E6EDF3] mb-4">Create Invoice</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Client *</label>
              <select required value={form.clientUserId} onChange={e => setForm(f => ({ ...f, clientUserId: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22] text-[#E6EDF3]">
                <option value="">— Select Client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name ?? c.email}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Invoice Number *</label>
              <input required value={form.invoiceNumber} onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))}
                placeholder="INV-2026-004"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Type</label>
              <select value={form.invoiceType} onChange={e => setForm(f => ({ ...f, invoiceType: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22] text-[#E6EDF3]">
                <option value="instant">Instant (one-time)</option>
                <option value="retainer">Retainer (subscription)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Amount (USD) *</label>
              <input required type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="5000.00"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Due Date</label>
              <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Milestone 2: Pilot & Training"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">PDF (optional)</label>
              <input type="file" accept=".pdf" onChange={e => setPdfFile(e.target.files?.[0] ?? null)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none file:mr-3 file:text-xs file:font-semibold file:bg-[#0078D4] file:text-white file:border-0 file:rounded file:px-2 file:py-1 file:cursor-pointer" />
            </div>
            {error && <div className="sm:col-span-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={uploading}
                className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {uploading ? "Creating…" : "Create Invoice"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setError(""); }}
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#1C2128] transition-colors text-[#E6EDF3]">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={filterType} onChange={e => { setFilterType(e.target.value); setLoading(true); }}
          className="border border-border rounded-lg px-3 py-1.5 text-sm bg-[#1C2128] text-[#E6EDF3] focus:outline-none focus:ring-1 focus:ring-[#0078D4]">
          <option value="all">All Types</option>
          <option value="instant">Instant</option>
          <option value="retainer">Retainer</option>
        </select>
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setLoading(true); }}
          className="border border-border rounded-lg px-3 py-1.5 text-sm bg-[#1C2128] text-[#E6EDF3] focus:outline-none focus:ring-1 focus:ring-[#0078D4]">
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="due">Due</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
        </select>
        {(filterType !== "all" || filterStatus !== "all") && (
          <button onClick={() => { setFilterType("all"); setFilterStatus("all"); }}
            className="text-xs text-muted-foreground hover:text-[#E6EDF3] transition-colors underline">
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{invoices.length} invoice{invoices.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="bg-[#161B22] border border-border rounded-xl py-20 flex flex-col items-center text-center gap-2">
          <div className="w-12 h-12 rounded-full bg-[#0078D4]/10 flex items-center justify-center mb-1">
            <svg className="w-6 h-6 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <p className="font-semibold text-[#E6EDF3] text-sm">No invoices found</p>
          <p className="text-xs text-muted-foreground max-w-xs mb-3">
            {filterType !== "all" || filterStatus !== "all" ? "Try adjusting the filters above." : "Create your first invoice to bill a client."}
          </p>
          {filterType === "all" && filterStatus === "all" && (
            <button onClick={() => { setShowForm(true); setError(""); }}
              className="flex items-center gap-2 bg-[#0078D4] text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              New Invoice
            </button>
          )}
        </div>
      ) : (
        <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1C2128] border-b border-border">
              <tr>
                <Th label="Invoice" sortable="invoiceNumber" />
                <Th label="Client" />
                <Th label="Type" />
                <Th label="Amount" sortable="amount" />
                <Th label="Status" sortable="status" />
                <Th label="Due" sortable="dueDate" />
                <Th label="Created" sortable="createdAt" />
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/crm/invoices/${inv.id}`)}
                  className="border-b border-border last:border-0 hover:bg-[#1C2128] transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3.5">
                    <p className="font-semibold text-[#E6EDF3]">{inv.invoiceNumber}</p>
                    {inv.description && <p className="text-xs text-muted-foreground truncate max-w-[180px]">{inv.description}</p>}
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="text-[#E6EDF3] text-sm">{clientDisplayName(inv)}</p>
                    {inv.clientCompany && <p className="text-xs text-muted-foreground">{inv.clientCompany}</p>}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_COLORS[inv.invoiceType] ?? "bg-[#30363D]/50 text-[#7D8590]"}`}>
                      {inv.invoiceType === "instant" ? "Instant" : "Retainer"}
                    </span>
                    {inv.stripeSubscriptionId && (
                      <span className="ml-1.5 text-[10px] text-purple-400 font-semibold">↻</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="font-bold text-[#E6EDF3]">{fmt(inv.amount, inv.currency)}</p>
                    {inv.discountAmount && parseFloat(inv.discountAmount) > 0 && (
                      <p className="text-[10px] text-emerald-400">-{fmt(inv.discountAmount, inv.currency)} discount</p>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[inv.status] ?? "bg-[#30363D]/50 text-[#7D8590]"}`}>
                      {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-muted-foreground">
                    {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-muted-foreground">
                    {new Date(inv.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
