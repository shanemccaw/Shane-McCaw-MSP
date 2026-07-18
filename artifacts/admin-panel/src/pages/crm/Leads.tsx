import { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import QualificationModal from "@/components/QualificationModal";

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
  new: "bg-primary/100/15 text-blue-400",
  contacted: "bg-yellow-500/15 text-yellow-400",
  qualified: "bg-purple-500/15 text-purple-400",
  converted: "bg-green-500/15 text-green-400",
  archived: "bg-border/50 text-muted-foreground",
};

const SOURCE_COLORS: Record<LeadSource, string> = {
  contact_form: "bg-primary/10 text-primary",
  lead_magnet: "bg-teal-500/15 text-teal-400",
};

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-extrabold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

export default function LeadsPage() {
  const { toast } = useToast();
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("active");
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
      if (status !== "all" && status !== "active") params.set("status", status);
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
  }, [fetchWithAuth]);

  useEffect(() => {
    void Promise.all([fetchStats(), fetchLeads(1, "active", "all")]);
  }, [fetchStats, fetchLeads]);

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

  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = async (e: React.MouseEvent, lead: Lead) => {
    e.stopPropagation();
    if (!confirm(`Delete "${lead.name}" and all associated data? This cannot be undone.`)) return;
    setDeletingId(lead.id);
    try {
      const res = await fetchWithAuth(`/api/leads/${lead.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setLeads(prev => prev.filter(l => l.id !== lead.id));
      setTotal(prev => prev - 1);
    } catch {
      toast({ title: "Failed to delete lead", description: "Please try again.", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const totalPages = Math.ceil(total / LIMIT);

  const STATUS_TABS = [
    { key: "active", label: "Active" },
    { key: "new", label: "New" },
    { key: "contacted", label: "Contacted" },
    { key: "qualified", label: "Qualified" },
    { key: "converted", label: "Converted" },
    { key: "archived", label: "Archived" },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-[1200px]">
      <QualificationModal />
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Leads</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage inbound leads from the contact form and lead magnet.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Leads" value={stats?.total ?? 0}
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-primary" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>}
        />
        <StatCard label="New This Week" value={stats?.newThisWeek ?? 0}
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-primary" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard label="From Contact Form" value={stats?.fromContactForm ?? 0}
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-primary" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>}
        />
        <StatCard label="From Lead Magnet" value={stats?.fromLeadMagnet ?? 0}
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-primary" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>}
        />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 pt-5 pb-4 border-b border-border">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_TABS.map(tab => (
                <button key={tab.key} onClick={() => handleFilterChange(tab.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${statusFilter === tab.key ? "bg-primary text-white" : "bg-accent text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}>
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="sm:ml-auto">
              <select value={sourceFilter} onChange={e => handleSourceChange(e.target.value)}
                className="border border-border rounded-lg px-3 py-1.5 text-xs font-medium bg-card focus:outline-none focus:ring-2 focus:ring-primary bg-accent text-foreground">
                <option value="all">All Sources</option>
                <option value="contact_form">Contact Form</option>
                <option value="lead_magnet">Lead Magnet</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-sm">No leads match your current filters.</p>
          </div>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-accent">
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Company</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Date</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {leads.map(lead => (
                    <tr key={lead.id} onClick={() => navigate(`/crm/leads/${lead.id}`)}
                      className="border-b border-border last:border-0 hover:bg-accent cursor-pointer transition-colors group">
                      <td className="px-5 py-3.5 font-semibold text-foreground">{lead.name}</td>
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
                      <td className="px-2 py-3.5 text-right">
                        <button
                          onClick={(e) => void handleDelete(e, lead)}
                          disabled={deletingId === lead.id}
                          title="Delete lead"
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-muted-foreground/60 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                        >
                          {deletingId === lead.id
                            ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          }
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sm:hidden divide-y divide-border">
              {leads.map(lead => (
                <div key={lead.id} onClick={() => navigate(`/crm/leads/${lead.id}`)}
                  className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-accent transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{lead.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{lead.email}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[lead.status]}`}>{lead.status}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[lead.source]}`}>
                      {lead.source === "contact_form" ? "Form" : "Magnet"}
                    </span>
                  </div>
                  <button
                    onClick={(e) => void handleDelete(e, lead)}
                    disabled={deletingId === lead.id}
                    title="Delete lead"
                    className="ml-1 p-1.5 rounded text-muted-foreground/60 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50 flex-shrink-0"
                  >
                    {deletingId === lead.id
                      ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                      : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    }
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-4 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button disabled={page <= 1}
                onClick={() => { const p = page - 1; setPage(p); void fetchLeads(p, statusFilter, sourceFilter); }}
                className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-accent transition-colors">
                Prev
              </button>
              <button disabled={page >= totalPages}
                onClick={() => { const p = page + 1; setPage(p); void fetchLeads(p, statusFilter, sourceFilter); }}
                className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-accent transition-colors">
                Next
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
