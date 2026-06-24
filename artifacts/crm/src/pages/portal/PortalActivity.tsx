import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";
import { formatActivityItem, dateBucket, relativeTime, type AuditLogEntry } from "@/lib/auditFormatter";

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
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0118 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-[#0A2540]">No activity yet</p>
      <p className="text-xs text-muted-foreground mt-1">Your activity will appear here as actions are taken.</p>
    </div>
  );
}

const ICON_PATHS: Record<string, React.ReactNode> = {
  task: <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
  invoice: <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />,
  service: <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />,
  project: <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />,
  report: <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  contract: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  lead: <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
  document: <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />,
  user: <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />,
  default: <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
};

function ActivityIcon({ type, colorClass }: { type: string; colorClass: string }) {
  const textColor = colorClass.split(" ")[0] ?? "text-gray-500";
  return (
    <svg className={`w-4 h-4 ${textColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      {ICON_PATHS[type] ?? ICON_PATHS.default}
    </svg>
  );
}

function RichActivityItem({ entry }: { entry: AuditLogEntry }) {
  const item = formatActivityItem(entry);
  const colorParts = item.color.split(" ");
  const bgColor = colorParts[1] ?? "bg-gray-100";

  const inner = (
    <div className={`flex items-start gap-3 px-5 py-3.5 transition-colors ${item.href ? "hover:bg-[#F7F9FC]/70 cursor-pointer" : "hover:bg-[#F7F9FC]/40"}`}>
      <div className={`w-9 h-9 rounded-xl ${bgColor} flex items-center justify-center flex-shrink-0 mt-0.5`}>
        <ActivityIcon type={item.icon} colorClass={item.color} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#0A2540] leading-snug">{item.label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{relativeTime(entry.createdAt)}</p>
      </div>
    </div>
  );

  return item.href ? (
    <Link href={item.href}>{inner}</Link>
  ) : (
    <>{inner}</>
  );
}

const BUCKET_ORDER = ["Today", "Yesterday", "Earlier"] as const;
type Bucket = typeof BUCKET_ORDER[number];

function groupByBucket(entries: AuditLogEntry[]): Map<Bucket, AuditLogEntry[]> {
  const map = new Map<Bucket, AuditLogEntry[]>();
  for (const entry of entries) {
    const b = dateBucket(entry.createdAt) as Bucket;
    if (!map.has(b)) map.set(b, []);
    map.get(b)!.push(entry);
  }
  return map;
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
  const bucketMap = data ? groupByBucket(data.entries) : new Map<Bucket, AuditLogEntry[]>();

  return (
    <PortalLayout>
      <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-4xl mx-auto">
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
                {BUCKET_ORDER.map(bucket => {
                  const items = bucketMap.get(bucket);
                  if (!items || items.length === 0) return null;
                  return (
                    <div key={bucket}>
                      <div className="px-5 py-2 bg-[#F7F9FC] border-b border-border">
                        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{bucket}</span>
                      </div>
                      {items.map(entry => (
                        <div key={entry.id} className="border-b border-border last:border-0">
                          <RichActivityItem entry={entry} />
                        </div>
                      ))}
                    </div>
                  );
                })}
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
