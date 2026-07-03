import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface ShareClient {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
}

interface ResultShare {
  id: number;
  shareToken: string;
  scoresSnapshot: Partial<Record<string, number>>;
  latestDate: string | null;
  expiresAt: string;
  viewCount: number;
  createdAt: string;
  client: ShareClient;
}

type SortField = "views" | "client" | "shared" | "expires";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "active" | "expired";

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtRelative(iso: string): string {
  const diff = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (diff < 0) return "Expired";
  const days = Math.floor(diff / 86400);
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function categoryLabel(key: string): string {
  const labels: Record<string, string> = {
    security: "Security",
    compliance: "Compliance",
    copilot: "Copilot",
    governance: "Governance",
    productivity: "Productivity",
  };
  return labels[key] ?? key;
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round((score / 100) * 100);
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 bg-[#30363D] rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-[#7D8590]">{score}</span>
    </div>
  );
}

function ViewsBadge({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#30363D]/50 text-[#484F58]">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        0
      </span>
    );
  }
  const color = count >= 10 ? "bg-green-500/15 text-green-400" : count >= 3 ? "bg-[#0078D4]/15 text-blue-400" : "bg-[#30363D]/50 text-[#7D8590]";
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
      {count}
    </span>
  );
}

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) {
    return (
      <svg className="w-3 h-3 text-[#484F58] ml-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
      </svg>
    );
  }
  return sortDir === "asc" ? (
    <svg className="w-3 h-3 text-[#0078D4] ml-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-3 h-3 text-[#0078D4] ml-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function shareUrl(token: string): string {
  return `${window.location.origin}/crm/shared-results/${token}`;
}

export default function DiagnosticSharesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortField, setSortField] = useState<SortField>("views");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  function copyLink(share: ResultShare) {
    const url = shareUrl(share.shareToken);
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(share.id);
      toast({ title: "Link copied", description: `Share link for ${share.client.name ?? share.client.email} copied to clipboard.` });
      setTimeout(() => setCopiedId(id => id === share.id ? null : id), 2000);
    }).catch(() => {
      toast({ title: "Copy failed", description: "Could not access clipboard. Try opening the link instead.", variant: "destructive" });
    });
  }

  const { data, isLoading, isError } = useQuery<{ shares: ResultShare[] }>({
    queryKey: ["admin-diagnostic-shares"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/quick-win/result-shares");
      if (!res.ok) throw new Error("Failed to load result shares");
      return res.json();
    },
  });

  const shares = data?.shares ?? [];

  const activeCount = shares.filter(s => !isExpired(s.expiresAt)).length;
  const expiredCount = shares.filter(s => isExpired(s.expiresAt)).length;
  const totalViews = shares.reduce((sum, s) => sum + s.viewCount, 0);
  const highEngagement = shares.filter(s => !isExpired(s.expiresAt) && s.viewCount >= 3).length;

  const filtered = useMemo(() => {
    let rows = [...shares];

    if (statusFilter === "active") rows = rows.filter(s => !isExpired(s.expiresAt));
    else if (statusFilter === "expired") rows = rows.filter(s => isExpired(s.expiresAt));

    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(s =>
        (s.client.name ?? "").toLowerCase().includes(q) ||
        s.client.email.toLowerCase().includes(q) ||
        (s.client.company ?? "").toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => {
      let cmp = 0;
      if (sortField === "views") cmp = a.viewCount - b.viewCount;
      else if (sortField === "client") cmp = (a.client.name ?? a.client.email).localeCompare(b.client.name ?? b.client.email);
      else if (sortField === "shared") cmp = a.createdAt.localeCompare(b.createdAt);
      else if (sortField === "expires") cmp = a.expiresAt.localeCompare(b.expiresAt);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [shares, search, statusFilter, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-14 bg-[#161B22] border border-[#30363D] rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Failed to load diagnostic shares
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-white">Diagnostic Result Shares</h2>
        <p className="text-sm text-[#7D8590] mt-0.5">
          Clients who shared their M365 diagnostic results — a high view count signals internal buy-in worth following up.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Shares", value: shares.length, sub: "all time" },
          { label: "Active", value: activeCount, sub: "not yet expired", highlight: "text-green-400" },
          { label: "Total Views", value: totalViews, sub: "across all links", highlight: totalViews > 0 ? "text-[#0078D4]" : undefined },
          { label: "High Engagement", value: highEngagement, sub: "active, 3+ views", highlight: highEngagement > 0 ? "text-yellow-400" : undefined },
        ].map(stat => (
          <div key={stat.label} className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
            <div className={`text-2xl font-bold ${stat.highlight ?? "text-white"}`}>{stat.value}</div>
            <div className="text-xs font-medium text-[#7D8590] mt-0.5">{stat.label}</div>
            <div className="text-xs text-[#484F58] mt-0.5">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#484F58]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by client name, email, or company…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg py-2 pl-9 pr-3 text-sm text-white placeholder:text-[#484F58] focus:outline-none focus:border-[#0078D4]"
          />
        </div>
        <div className="flex rounded-lg overflow-hidden border border-[#30363D] shrink-0">
          {(["all", "active", "expired"] as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${
                statusFilter === f
                  ? "bg-[#0078D4] text-white"
                  : "bg-[#0D1117] text-[#7D8590] hover:text-white hover:bg-[#161B22]"
              }`}
            >
              {f === "all" ? `All (${shares.length})` : f === "active" ? `Active (${activeCount})` : `Expired (${expiredCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-10 text-center">
          <svg className="w-8 h-8 text-[#30363D] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <p className="text-sm text-[#484F58]">
            {shares.length === 0 ? "No clients have shared diagnostic results yet." : "No results match your filters."}
          </p>
        </div>
      ) : (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#30363D]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#484F58] uppercase tracking-wider">
                    <button
                      onClick={() => toggleSort("client")}
                      className="inline-flex items-center gap-0.5 hover:text-[#7D8590] transition-colors"
                    >
                      Client
                      <SortIcon field="client" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#484F58] uppercase tracking-wider">
                    Scores
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#484F58] uppercase tracking-wider">
                    <button
                      onClick={() => toggleSort("views")}
                      className="inline-flex items-center gap-0.5 hover:text-[#7D8590] transition-colors"
                    >
                      Views
                      <SortIcon field="views" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#484F58] uppercase tracking-wider">
                    <button
                      onClick={() => toggleSort("shared")}
                      className="inline-flex items-center gap-0.5 hover:text-[#7D8590] transition-colors"
                    >
                      Shared
                      <SortIcon field="shared" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#484F58] uppercase tracking-wider">
                    <button
                      onClick={() => toggleSort("expires")}
                      className="inline-flex items-center gap-0.5 hover:text-[#7D8590] transition-colors"
                    >
                      Expires
                      <SortIcon field="expires" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#484F58] uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-[#484F58] uppercase tracking-wider text-right">
                    Link
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363D]">
                {filtered.map(share => {
                  const expired = isExpired(share.expiresAt);
                  const scores = Object.entries(share.scoresSnapshot ?? {});
                  return (
                    <tr
                      key={share.id}
                      className={`transition-colors ${expired ? "opacity-50" : "hover:bg-[#1C2128]"}`}
                    >
                      {/* Client */}
                      <td className="px-4 py-3">
                        <Link
                          href={`/crm/clients/${share.client.id}`}
                          className="block hover:underline"
                        >
                          <div className="font-medium text-white">
                            {share.client.name ?? share.client.email}
                          </div>
                          {share.client.name && (
                            <div className="text-xs text-[#7D8590]">{share.client.email}</div>
                          )}
                          {share.client.company && (
                            <div className="text-xs text-[#484F58]">{share.client.company}</div>
                          )}
                        </Link>
                      </td>

                      {/* Scores */}
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          {scores.length === 0 ? (
                            <span className="text-xs text-[#484F58]">—</span>
                          ) : (
                            scores.map(([cat, score]) => (
                              <div key={cat} className="flex items-center gap-2">
                                <span className="text-xs text-[#7D8590] w-20 shrink-0">{categoryLabel(cat)}</span>
                                <ScoreBar score={score ?? 0} />
                              </div>
                            ))
                          )}
                        </div>
                      </td>

                      {/* Views */}
                      <td className="px-4 py-3">
                        <ViewsBadge count={share.viewCount} />
                      </td>

                      {/* Shared date */}
                      <td className="px-4 py-3 text-[#7D8590] text-xs whitespace-nowrap">
                        {fmtDate(share.createdAt)}
                      </td>

                      {/* Expires */}
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {expired ? (
                          <span className="text-[#484F58]">{fmtDate(share.expiresAt)}</span>
                        ) : (
                          <span className="text-[#7D8590]">
                            {fmtDate(share.expiresAt)}
                            <span className="ml-1 text-[#484F58]">({fmtRelative(share.expiresAt)})</span>
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {expired ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#30363D]/50 text-[#484F58]">
                            Expired
                          </span>
                        ) : share.viewCount >= 3 ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-500/15 text-yellow-400">
                            🔥 High engagement
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400">
                            Active
                          </span>
                        )}
                      </td>

                      {/* Actions — copy link + open in new tab */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {/* Copy */}
                          <button
                            onClick={() => copyLink(share)}
                            title="Copy share link"
                            className="p-1.5 rounded-lg text-[#484F58] hover:text-white hover:bg-[#30363D] transition-colors"
                          >
                            {copiedId === share.id ? (
                              <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>

                          {/* Open in new tab */}
                          <a
                            href={shareUrl(share.shareToken)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open share link"
                            className="p-1.5 rounded-lg text-[#484F58] hover:text-white hover:bg-[#30363D] transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-[#30363D] text-xs text-[#484F58]">
            {filtered.length} {filtered.length === 1 ? "share" : "shares"}{filtered.length !== shares.length ? ` of ${shares.length} total` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
