import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";
import { formatAuditEntry, type AuditLogEntry } from "@/lib/auditFormatter";

interface AuditResponse {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#0078D4]/10 flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-[#0A2540]">No activity yet</p>
      <p className="text-xs text-muted-foreground mt-1">Your activity will appear here as actions are taken.</p>
    </div>
  );
}

export default function PortalActivity() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/audit-logs/me?page=${p}`);
      if (res.ok) setData(await res.json() as AuditResponse);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void fetchLogs(page);
  }, [fetchLogs, page]);

  const totalPages = data ? Math.ceil(data.total / (data.pageSize || 25)) : 1;

  return (
    <PortalLayout>
      <div className="px-6 py-8 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold text-[#0A2540]">Activity</h1>
          <p className="text-sm text-muted-foreground mt-1">A record of all actions taken on your account.</p>
        </div>

        <div className="bg-white border border-border rounded-xl overflow-hidden">
          {loading ? (
            <Spinner />
          ) : !data || data.entries.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div className="divide-y divide-border">
                {data.entries.map(entry => (
                  <div key={entry.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-[#F7F9FC]/60 transition-colors">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${entry.actorRole === "admin" ? "bg-[#0078D4]" : "bg-emerald-500"}`} />
                    <p className="text-sm text-[#0A2540] leading-snug flex-1">{formatAuditEntry(entry)}</p>
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-[#F7F9FC]/40">
                  <p className="text-xs text-muted-foreground">
                    {((page - 1) * (data.pageSize ?? 25)) + 1}–{Math.min(page * (data.pageSize ?? 25), data.total)} of {data.total}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-white hover:bg-[#F7F9FC] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ← Prev
                    </button>
                    <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-white hover:bg-[#F7F9FC] disabled:opacity-40 disabled:cursor-not-allowed"
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
    </PortalLayout>
  );
}
