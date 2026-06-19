import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import AdminClients from "@/pages/admin/AdminClients";
import AdminProjects from "@/pages/admin/AdminProjects";
import AdminReports from "@/pages/admin/AdminReports";
import AdminInvoices from "@/pages/admin/AdminInvoices";
import AdminMessages from "@/pages/admin/AdminMessages";
import AdminDocuments from "@/pages/admin/AdminDocuments";

type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "archived";
type LeadSource = "contact_form" | "lead_magnet";

interface Lead {
  id: number;
  name: string;
  email: string;
  company: string | null;
  companySize: string | null;
  serviceArea: string | null;
  message: string | null;
  source: LeadSource;
  status: LeadStatus;
  howFound: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LeadList {
  leads: Lead[];
  total: number;
  page: number;
  limit: number;
}

interface LeadStats {
  total: number;
  newThisWeek: number;
  fromContactForm: number;
  fromLeadMagnet: number;
}

const STATUS_COLORS: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-yellow-100 text-yellow-700",
  qualified: "bg-purple-100 text-purple-700",
  converted: "bg-green-100 text-green-700",
  archived: "bg-gray-100 text-gray-500",
};

const SOURCE_COLORS: Record<LeadSource, string> = {
  contact_form: "bg-[#0078D4]/10 text-[#0078D4]",
  lead_magnet: "bg-teal-100 text-teal-700",
};

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="bg-white border border-border rounded-xl p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-extrabold text-[#0A2540]">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function SlideOver({ lead, onClose, onStatusChange }: {
  lead: Lead;
  onClose: () => void;
  onStatusChange: (lead: Lead) => void;
}) {
  const { fetchWithAuth } = useAuth();
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json() as Lead;
        onStatusChange(updated);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full sm:max-w-md bg-white shadow-2xl overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-[#0A2540]">
          <h2 className="text-white font-bold">Lead Details</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors text-xl leading-none">×</button>
        </div>
        <div className="flex-1 px-6 py-6 space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Name</p>
            <p className="text-[#0A2540] font-semibold">{lead.name}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Email</p>
            <a href={`mailto:${lead.email}`} className="text-[#0078D4] hover:underline text-sm">{lead.email}</a>
          </div>
          {lead.company && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Company</p>
              <p className="text-[#0A2540] text-sm">{lead.company}{lead.companySize ? ` (${lead.companySize})` : ""}</p>
            </div>
          )}
          {lead.serviceArea && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Service Area</p>
              <p className="text-[#0A2540] text-sm">{lead.serviceArea}</p>
            </div>
          )}
          {lead.message && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Message</p>
              <p className="text-[#0A2540] text-sm leading-relaxed whitespace-pre-wrap">{lead.message}</p>
            </div>
          )}
          {lead.howFound && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">How They Found Shane</p>
              <p className="text-[#0A2540] text-sm">{lead.howFound}</p>
            </div>
          )}
          <div className="flex gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Source</p>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${SOURCE_COLORS[lead.source]}`}>
                {lead.source === "contact_form" ? "Contact Form" : "Lead Magnet"}
              </span>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Date</p>
              <p className="text-sm text-[#0A2540]">{new Date(lead.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Update Status</p>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as LeadStatus)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
            >
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Qualified</option>
              <option value="converted">Converted</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-border flex gap-3">
          <button
            onClick={save}
            disabled={saving || status === lead.status}
            className="flex-1 bg-[#0078D4] text-white font-semibold rounded-lg py-2.5 text-sm hover:bg-[#0078D4]/90 transition-colors disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <button
            onClick={onClose}
            className="px-4 border border-border rounded-lg text-sm font-medium text-muted-foreground hover:bg-[#F7F9FC] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function LeadsPanel() {
  const { fetchWithAuth } = useAuth();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const LIMIT = 20;

  const fetchStats = useCallback(async () => {
    const res = await fetchWithAuth("/api/leads/stats");
    if (res.ok) setStats(await res.json() as LeadStats);
  }, [fetchWithAuth]);

  const fetchLeads = useCallback(async (p = 1, status = "all", source = "all") => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (status !== "all") params.set("status", status);
      if (source !== "all") params.set("source", source);
      const res = await fetchWithAuth(`/api/leads?${params.toString()}`);
      if (res.ok) {
        const data = await res.json() as LeadList;
        setLeads(data.leads);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, LIMIT]);

  useEffect(() => {
    void Promise.all([fetchStats(), fetchLeads(1, "all", "all")]);
  }, [fetchStats, fetchLeads]);

  const handleStatusChange = () => {
    void Promise.all([fetchLeads(page, statusFilter, sourceFilter), fetchStats()]);
  };

  const handleFilterChange = (newStatus: string) => {
    setStatusFilter(newStatus);
    setPage(1);
    void fetchLeads(1, newStatus, sourceFilter);
  };

  const handleSourceChange = (newSource: string) => {
    setSourceFilter(newSource);
    setPage(1);
    void fetchLeads(1, statusFilter, newSource);
  };

  const totalPages = Math.ceil(total / LIMIT);

  const STATUS_TABS = [
    { key: "all", label: "All" },
    { key: "new", label: "New" },
    { key: "contacted", label: "Contacted" },
    { key: "qualified", label: "Qualified" },
    { key: "converted", label: "Converted" },
    { key: "archived", label: "Archived" },
  ];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Leads" value={stats?.total ?? 0}
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-[#0078D4]" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>}
        />
        <StatCard label="New This Week" value={stats?.newThisWeek ?? 0}
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-[#0078D4]" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard label="From Contact Form" value={stats?.fromContactForm ?? 0}
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-[#0078D4]" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>}
        />
        <StatCard label="From Lead Magnet" value={stats?.fromLeadMagnet ?? 0}
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-[#0078D4]" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>}
        />
      </div>

      <div className="bg-white border border-border rounded-xl overflow-hidden">
        <div className="px-5 pt-5 pb-4 border-b border-border">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_TABS.map(tab => (
                <button key={tab.key} onClick={() => handleFilterChange(tab.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${statusFilter === tab.key ? "bg-[#0078D4] text-white" : "bg-[#F7F9FC] text-muted-foreground hover:bg-[#0078D4]/10 hover:text-[#0078D4]"}`}
                  data-testid={`status-tab-${tab.key}`}>
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="sm:ml-auto">
              <select value={sourceFilter} onChange={e => handleSourceChange(e.target.value)}
                className="border border-border rounded-lg px-3 py-1.5 text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-[#0078D4]">
                <option value="all">All Sources</option>
                <option value="contact_form">Contact Form</option>
                <option value="lead_magnet">Lead Magnet</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <svg viewBox="0 0 24 24" fill="none" className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
            <p className="text-sm">No leads match your current filters.</p>
          </div>
        ) : (
          <>
            {/* Mobile card list — shown below sm breakpoint */}
            <div className="sm:hidden divide-y divide-border" data-testid="leads-table">
              {leads.map(lead => (
                <div
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-[#F7F9FC] transition-colors"
                  data-testid={`lead-row-${lead.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#0A2540] truncate">{lead.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{lead.email}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[lead.status]}`}>
                      {lead.status}
                    </span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[lead.source]}`}>
                      {lead.source === "contact_form" ? "Form" : "Magnet"}
                    </span>
                  </div>
                  <svg className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              ))}
            </div>
            {/* Desktop table — shown at sm+ */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-[#F7F9FC]">
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Company</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map(lead => (
                    <tr key={lead.id} onClick={() => setSelectedLead(lead)}
                      className="border-b border-border last:border-0 hover:bg-[#F7F9FC] cursor-pointer transition-colors"
                      data-testid={`lead-row-${lead.id}`}>
                      <td className="px-5 py-3.5 font-semibold text-[#0A2540]">{lead.name}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{lead.email}</td>
                      <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell">{lead.company ?? "—"}</td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${SOURCE_COLORS[lead.source]}`}>
                          {lead.source === "contact_form" ? "Contact Form" : "Lead Magnet"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[lead.status]}`}>
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground text-xs hidden lg:table-cell">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button disabled={page <= 1}
                onClick={() => { const p = page - 1; setPage(p); void fetchLeads(p, statusFilter, sourceFilter); }}
                className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-[#F7F9FC] transition-colors">
                Prev
              </button>
              <button disabled={page >= totalPages}
                onClick={() => { const p = page + 1; setPage(p); void fetchLeads(p, statusFilter, sourceFilter); }}
                className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-[#F7F9FC] transition-colors">
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedLead && (
        <SlideOver lead={selectedLead} onClose={() => setSelectedLead(null)} onStatusChange={handleStatusChange} />
      )}
    </>
  );
}

// ─── Admin: Purchases panel ───────────────────────────────────────────────────
interface Purchase {
  id: number;
  invoiceNumber: string;
  description: string | null;
  amount: string;
  currency: string;
  status: string;
  paidAt: string | null;
  stripeSessionId: string | null;
  createdAt: string;
  clientEmail: string | null;
  clientName: string | null;
  clientCompany: string | null;
}

function AdminPurchases() {
  const { fetchWithAuth } = useAuth();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/admin/purchases")
      .then(r => r.json() as Promise<Purchase[]>)
      .then(data => { setPurchases(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fetchWithAuth]);

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#0A2540]">Self-Service Purchases</h2>
        <span className="text-sm text-muted-foreground">{purchases.length} total</span>
      </div>
      {purchases.length === 0 ? (
        <div className="bg-white border border-border rounded-xl py-20 text-center text-muted-foreground text-sm">
          No self-service purchases yet. Purchases appear here once clients complete checkout.
        </div>
      ) : (
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-[#F7F9FC]">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Client</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Service</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Amount</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map(p => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-[#F7F9FC] transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-[#0A2540]">{p.clientName ?? p.clientEmail ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{p.clientEmail}</p>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell">{p.description ?? p.invoiceNumber}</td>
                    <td className="px-5 py-3.5 font-bold text-[#0A2540]">${parseFloat(p.amount).toFixed(2)}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${p.status === "paid" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs hidden lg:table-cell">{new Date(p.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin: Contracts panel ───────────────────────────────────────────────────
interface Contract {
  id: number;
  serviceId: number;
  userId: number;
  signerName: string | null;
  signedAt: string;
  contractVersion: string;
  projectId: number | null;
  stripeSessionId: string | null;
  serviceName: string | null;
  serviceSlug: string | null;
  clientEmail: string | null;
  clientCompany: string | null;
}

function AdminContracts() {
  const { fetchWithAuth } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/admin/contracts")
      .then(r => r.json() as Promise<Contract[]>)
      .then(data => { setContracts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fetchWithAuth]);

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#0A2540]">Signed Contracts</h2>
        <span className="text-sm text-muted-foreground">{contracts.length} total</span>
      </div>
      {contracts.length === 0 ? (
        <div className="bg-white border border-border rounded-xl py-20 text-center text-muted-foreground text-sm">
          No signed contracts yet. Contracts appear here after clients complete the onboarding agreement step.
        </div>
      ) : (
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-[#F7F9FC]">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Signer</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Service</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Version</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Project</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Signed</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-[#F7F9FC] transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-[#0A2540]">{c.signerName ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{c.clientEmail}</p>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell">{c.serviceName ?? c.serviceSlug ?? "—"}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#0078D4]/10 text-[#0078D4]">{c.contractVersion}</span>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      {c.projectId ? (
                        <span className="text-xs bg-green-100 text-green-700 font-semibold px-2.5 py-1 rounded-full">Project #{c.projectId}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Pending payment</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs hidden lg:table-cell">{new Date(c.signedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

type AdminTab = "leads" | "clients" | "projects" | "reports" | "documents" | "invoices" | "messages" | "purchases" | "contracts";

const ADMIN_TABS: { key: AdminTab; label: string; icon: React.ReactNode }[] = [
  { key: "leads", label: "Leads", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg> },
  { key: "clients", label: "Clients", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> },
  { key: "projects", label: "Projects", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg> },
  { key: "reports", label: "Reports", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
  { key: "documents", label: "Documents", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg> },
  { key: "invoices", label: "Invoices", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg> },
  { key: "messages", label: "Messages", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg> },
  { key: "purchases", label: "Purchases", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 006.75 19.5z" /></svg> },
  { key: "contracts", label: "Contracts", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" /></svg> },
];

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<AdminTab>("leads");

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-[#F7F9FC] flex flex-col">
      <header className="bg-[#0A2540] px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
            </svg>
          </div>
          <div>
            <span className="text-white font-bold text-sm">Admin Dashboard</span>
            <span className="text-white/40 text-xs ml-2 hidden sm:inline">Shane McCaw Consulting</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-white/50 text-xs hidden sm:block">{user?.email}</span>
          <button
            onClick={handleLogout}
            className="text-white/70 text-sm hover:text-white transition-colors border border-white/20 rounded-lg px-3 py-1.5 hover:bg-white/10"
          >
            Log out
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 py-8">
        {/* Admin Tab Bar */}
        <div className="flex flex-wrap gap-1.5 mb-8 border-b border-border pb-4">
          {ADMIN_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                activeTab === tab.key
                  ? "bg-[#0078D4] text-white shadow-md shadow-[#0078D4]/20"
                  : "bg-white text-[#0A2540] border border-border hover:border-[#0078D4]/40 hover:text-[#0078D4]"
              }`}
              data-testid={`admin-tab-${tab.key}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "leads" && <LeadsPanel />}
        {activeTab === "clients" && <AdminClients />}
        {activeTab === "projects" && <AdminProjects />}
        {activeTab === "reports" && <AdminReports />}
        {activeTab === "documents" && <AdminDocuments />}
        {activeTab === "invoices" && <AdminInvoices />}
        {activeTab === "messages" && <AdminMessages />}
        {activeTab === "purchases" && <AdminPurchases />}
        {activeTab === "contracts" && <AdminContracts />}
      </div>
    </div>
  );
}
