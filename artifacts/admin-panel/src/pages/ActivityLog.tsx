import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { formatAuditEntry, ENTITY_TYPE_LABELS, type AuditLogEntry } from "@/lib/auditFormatter";

interface Client {
  id: number;
  name: string | null;
  email: string;
}

interface AuditResponse {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-foreground">No activity yet</p>
      <p className="text-xs text-muted-foreground mt-1">Actions will appear here as they happen.</p>
    </div>
  );
}

function EntityBadge({ type }: { type: string }) {
  const label = ENTITY_TYPE_LABELS[type] ?? type;
  const colorMap: Record<string, string> = {
    kanban_task: "bg-primary/100/15 text-blue-400",
    invoice: "bg-green-500/15 text-green-400",
    contract: "bg-purple-500/15 text-purple-400",
    service: "bg-orange-500/15 text-orange-400",
    project: "bg-cyan-500/15 text-cyan-400",
    workflow_step: "bg-yellow-500/15 text-yellow-400",
    status_report: "bg-indigo-500/15 text-indigo-400",
    lead: "bg-pink-500/15 text-pink-400",
    user: "bg-border/50 text-muted-foreground",
    document: "bg-teal-500/15 text-teal-400",
  };
  const cls = colorMap[type] ?? "bg-border/50 text-muted-foreground";
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${cls}`}>{label}</span>
  );
}

function RoleDot({ role }: { role: string }) {
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${role === "admin" ? "bg-primary" : "bg-emerald-500"}`} />
  );
}

export default function ActivityLogPage() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<AuditResponse | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [clientFilter, setClientFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (clientFilter) params.set("clientId", clientFilter);
      if (entityFilter !== "all") params.set("entityType", entityFilter);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);

      const res = await fetchWithAuth(`/api/audit-logs?${params.toString()}`);
      if (res.ok) setData(await res.json() as AuditResponse);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, clientFilter, entityFilter, fromDate, toDate]);

  useEffect(() => {
    fetchWithAuth("/api/audit-logs/clients")
      .then(r => r.json())
      .then(d => setClients(d as Client[]))
      .catch(() => null);
  }, [fetchWithAuth]);

  useEffect(() => {
    setPage(1);
    void fetchLogs(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter, entityFilter, fromDate, toDate]);

  useEffect(() => {
    void fetchLogs(page);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalPages = data ? Math.ceil(data.total / (data.pageSize || 25)) : 1;

  return (
    <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-foreground">Activity Log</h1>
        <p className="text-sm text-muted-foreground mt-1">Chronological audit trail of all admin and client actions.</p>
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-xs font-semibold text-foreground">Client</label>
          <select
            value={clientFilter}
            onChange={e => setClientFilter(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Clients</option>
            {clients.map(c => (
              <option key={c.id} value={String(c.id)}>{c.name ?? c.email}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-xs font-semibold text-foreground">Entity Type</label>
          <select
            value={entityFilter}
            onChange={e => setEntityFilter(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Types</option>
            {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-foreground">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-foreground">To</label>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {(clientFilter || entityFilter !== "all" || fromDate || toDate) && (
          <button
            onClick={() => { setClientFilter(""); setEntityFilter("all"); setFromDate(""); setToDate(""); }}
            className="text-xs text-muted-foreground hover:text-foreground underline mt-5"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Log */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <Spinner />
        ) : !data || data.entries.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="divide-y divide-border">
              {data.entries.map(entry => (
                <div key={entry.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-accent/60 transition-colors">
                  <RoleDot role={entry.actorRole} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground leading-snug">{formatAuditEntry(entry)}</p>
                  </div>
                  <EntityBadge type={entry.entityType} />
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-3 border-t border-border bg-accent/40">
                <p className="text-xs text-muted-foreground">
                  {((page - 1) * (data.pageSize ?? 25)) + 1}–{Math.min(page * (data.pageSize ?? 25), data.total)} of {data.total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Prev
                  </button>
                  <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
