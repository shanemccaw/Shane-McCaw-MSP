import { Link } from "wouter";
import { formatActivityItem, dateBucket, relativeTime, type AuditLogEntry } from "@/lib/auditFormatter";

function IconForType({ type, colorClass }: { type: string; colorClass: string }) {
  const iconClass = `w-3.5 h-3.5 ${colorClass.split(" ")[0]}`;
  switch (type) {
    case "task":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      );
    case "invoice":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      );
    case "service":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      );
    case "project":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      );
    case "report":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case "contract":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case "lead":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case "document":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    case "user":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      );
    default:
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
  }
}

function SkeletonItem() {
  return (
    <div className="flex items-start gap-2.5 px-4 py-3 animate-pulse">
      <div className="w-7 h-7 rounded-lg bg-gray-200 flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5 pt-0.5">
        <div className="h-3 bg-gray-200 rounded w-3/4" />
        <div className="h-2.5 bg-gray-100 rounded w-1/3" />
      </div>
    </div>
  );
}

interface ActivityFeedProps {
  entries: AuditLogEntry[];
  loading: boolean;
  onRefresh: () => void;
  compact?: boolean;
}

export default function ActivityFeed({ entries, loading, onRefresh, compact = false }: ActivityFeedProps) {
  const buckets: { label: "Today" | "Yesterday" | "Earlier"; items: AuditLogEntry[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Earlier", items: [] },
  ];

  for (const entry of entries) {
    const b = dateBucket(entry.createdAt);
    const bucket = buckets.find(bk => bk.label === b);
    if (bucket) bucket.items.push(entry);
  }

  const filledBuckets = buckets.filter(b => b.items.length > 0);

  return (
    <div className="bg-white border border-border rounded-xl flex flex-col overflow-hidden h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <h2 className="text-sm font-bold text-[#0A2540]">Recent Activity</h2>
        <button
          onClick={onRefresh}
          title="Refresh"
          className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-[#0078D4] transition-colors rounded-md hover:bg-[#F7F9FC]"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div>
            {[...Array(5)].map((_, i) => <SkeletonItem key={i} />)}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-4">
            <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0118 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <p className="text-xs font-semibold text-[#0A2540]">No activity yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">Actions will appear here.</p>
          </div>
        ) : (
          <div>
            {filledBuckets.map(bucket => (
              <div key={bucket.label}>
                <div className="px-4 py-1.5 bg-[#F7F9FC] border-b border-border">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{bucket.label}</span>
                </div>
                {bucket.items.map(entry => {
                  const item = formatActivityItem(entry);
                  const colorParts = item.color.split(" ");
                  const textColor = colorParts[0] ?? "text-gray-500";
                  const bgColor = colorParts[1] ?? "bg-gray-100";

                  const inner = (
                    <div className={`flex items-start gap-2.5 px-4 py-2.5 transition-colors ${item.href ? "hover:bg-[#F7F9FC] cursor-pointer" : ""}`}>
                      <div className={`w-7 h-7 rounded-lg ${bgColor} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <IconForType type={item.icon} colorClass={item.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium text-[#0A2540] leading-snug ${compact ? "line-clamp-2" : ""}`}>{item.label}</p>
                        <p className={`text-[10px] mt-0.5 ${textColor} font-medium`}>{relativeTime(entry.createdAt)}</p>
                      </div>
                    </div>
                  );

                  return item.href ? (
                    <Link key={entry.id} href={item.href}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={entry.id}>{inner}</div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border px-4 py-2.5 flex-shrink-0 bg-[#F7F9FC]/60">
        <Link href="/portal/activity">
          <span className="text-xs font-semibold text-[#0078D4] hover:underline cursor-pointer">View all activity →</span>
        </Link>
      </div>
    </div>
  );
}
