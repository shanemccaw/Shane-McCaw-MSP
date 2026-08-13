import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

interface M365Profile {
  orgName?: string;
  licenseSKUs?: string[];
  copilotReadinessScore?: number | string;
  hasCopilotLicenses?: boolean;
  mfaEnforced?: boolean;
  conditionalAccessEnabled?: boolean;
  allUsersLicensed?: boolean;
  authMethod?: string;
  hasAADP1orP2?: boolean;
  intuneEnabled?: boolean;
  hasDLP?: boolean;
  isHybrid?: boolean;
  activeUserPercent?: number;
  copilotUseCase?: string;
}

function readScore(p: M365Profile): number | null {
  const raw = p.copilotReadinessScore;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return isNaN(n) ? null : n;
}

interface ProfileRow {
  clientId: number;
  profile: M365Profile;
  updatedAt: string | null;
  clientName: string | null;
  clientEmail: string;
  clientCompany: string | null;
}

type SortField = "score" | "name" | "company" | "updatedAt";
type SortDir = "asc" | "desc";
type ScoreFilter = "all" | "1" | "2" | "3" | "4" | "5";

function deriveBlocker(p: M365Profile): string {
  if (!p.hasCopilotLicenses) return "No Copilot licenses";
  if (!p.mfaEnforced) return "MFA not enforced";
  if (!p.conditionalAccessEnabled) return "No Conditional Access";
  if (!p.allUsersLicensed) return "Incomplete licensing";
  if (!p.hasAADP1orP2) return "Missing Azure AD P1/P2";
  if (!p.intuneEnabled) return "Intune not enabled";
  if (!p.hasDLP) return "No DLP policies";
  if (p.isHybrid) return "Hybrid identity complexity";
  if ((p.activeUserPercent ?? 100) < 50) return "Low active user adoption";
  return "—";
}

function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-border/50 text-muted-foreground">
        N/A
      </span>
    );
  }
  const colors: Record<number, string> = {
    1: "bg-red-500/15 text-red-400",
    2: "bg-orange-500/15 text-orange-400",
    3: "bg-yellow-500/15 text-yellow-400",
    4: "bg-primary/100/15 text-blue-400",
    5: "bg-green-500/15 text-green-400",
  };
  const labels: Record<number, string> = {
    1: "Not Ready",
    2: "Early Stage",
    3: "Developing",
    4: "Nearly Ready",
    5: "Ready",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${colors[score] ?? "bg-border/50 text-muted-foreground"}`}>
      <span className="font-bold">{score}/5</span>
      <span className="opacity-75">{labels[score] ?? ""}</span>
    </span>
  );
}

function ScoreBar({ score }: { score: number | null | undefined }) {
  const val = score ?? 0;
  const pct = (val / 5) * 100;
  const color = val <= 1 ? "bg-red-400" : val <= 2 ? "bg-orange-400" : val <= 3 ? "bg-yellow-400" : val <= 4 ? "bg-blue-400" : "bg-green-400";
  return (
    <div className="w-20 bg-border rounded-full h-1.5 shrink-0">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) {
    return (
      <svg className="w-3.5 h-3.5 text-muted-foreground/60 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
      </svg>
    );
  }
  return sortDir === "asc" ? (
    <svg className="w-3.5 h-3.5 text-primary ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5 text-primary ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export default function M365IntelligencePage() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [search, setSearch] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function handleDelete(clientId: number) {
    setDeletingId(clientId);
    try {
      await fetchWithAuth(`/api/admin/m365-profiles/${clientId}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["m365-profiles"] });
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  const { data, isLoading, isError } = useQuery<{ profiles: ProfileRow[] }>({
    queryKey: ["m365-profiles"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/m365-profiles");
      if (!res.ok) throw new Error("Failed to load profiles");
      return res.json();
    },
  });

  const profiles = data?.profiles ?? [];

  const filtered = useMemo(() => {
    let rows = [...profiles];
    if (scoreFilter !== "all") {
      const target = parseInt(scoreFilter, 10);
      rows = rows.filter(r => readScore(r.profile) === target);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.clientName ?? "").toLowerCase().includes(q) ||
        r.clientEmail.toLowerCase().includes(q) ||
        (r.clientCompany ?? "").toLowerCase().includes(q)
      );
    }
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortField === "score") {
        const sa = readScore(a.profile) ?? 0;
        const sb = readScore(b.profile) ?? 0;
        cmp = sa - sb;
      } else if (sortField === "name") {
        cmp = (a.clientName ?? a.clientEmail).localeCompare(b.clientName ?? b.clientEmail);
      } else if (sortField === "company") {
        cmp = (a.clientCompany ?? "").localeCompare(b.clientCompany ?? "");
      } else if (sortField === "updatedAt") {
        cmp = (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [profiles, sortField, sortDir, scoreFilter, search]);

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "score" ? "asc" : "asc");
    }
  }

  const scoreGroups = useMemo(() => {
    const groups: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of profiles) {
      const s = readScore(r.profile);
      if (s != null && s >= 1 && s <= 5) groups[s]++;
    }
    return groups;
  }, [profiles]);

  const avgScore = useMemo(() => {
    const scores = profiles.map(r => readScore(r.profile)).filter((s): s is number => s != null);
    if (!scores.length) return null;
    const sum = scores.reduce((acc, s) => acc + s, 0);
    return (sum / scores.length).toFixed(1);
  }, [profiles]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">M365 Intelligence</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Copilot readiness scores and environment health across all clients with M365 profiles.
        </p>
      </div>

      {/* Summary cards */}
      {!isLoading && !isError && profiles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-card rounded-xl border border-border p-4 col-span-2 sm:col-span-1 lg:col-span-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Avg Score</p>
            <p className="mt-1 text-3xl font-bold text-primary">{avgScore ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">across {profiles.length} client{profiles.length !== 1 ? "s" : ""}</p>
          </div>
          {([1, 2, 3, 4, 5] as const).map(s => {
            const colors: Record<number, string> = { 1: "text-red-400", 2: "text-orange-400", 3: "text-yellow-400", 4: "text-primary", 5: "text-green-400" };
            const labels: Record<number, string> = { 1: "Not Ready", 2: "Early Stage", 3: "Developing", 4: "Nearly Ready", 5: "Ready" };
            return (
              <button
                key={s}
                onClick={() => setScoreFilter(scoreFilter === String(s) as ScoreFilter ? "all" : String(s) as ScoreFilter)}
                className={`bg-card rounded-xl border p-4 text-left transition-all ${scoreFilter === String(s) ? "border-primary ring-1 ring-primary" : "border-border"}`}
              >
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{labels[s]}</p>
                <p className={`mt-1 text-2xl font-bold ${colors[s]}`}>{scoreGroups[s]}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Score {s}/5</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client name, email, or company…"
            className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
        <select
          value={scoreFilter}
          onChange={e => setScoreFilter(e.target.value as ScoreFilter)}
          className="text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary bg-card"
        >
          <option value="all">All scores</option>
          <option value="1">Score 1 — Not Ready</option>
          <option value="2">Score 2 — Early Stage</option>
          <option value="3">Score 3 — Developing</option>
          <option value="4">Score 4 — Nearly Ready</option>
          <option value="5">Score 5 — Ready</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-muted-foreground">Failed to load M365 profiles.</p>
          </div>
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
            <svg className="w-10 h-10 text-muted-foreground/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
            </svg>
            <p className="text-sm font-medium text-muted-foreground">No M365 profiles yet</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Open a client in the Clients page and complete their M365 Environment Profile to see them here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-card border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3">
                    <button
                      onClick={() => toggleSort("name")}
                      className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground"
                    >
                      Client
                      <SortIcon field="name" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3">
                    <button
                      onClick={() => toggleSort("score")}
                      className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground"
                    >
                      Readiness Score
                      <SortIcon field="score" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    License SKUs
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Primary Blocker
                  </th>
                  <th className="text-left px-4 py-3">
                    <button
                      onClick={() => toggleSort("updatedAt")}
                      className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground"
                    >
                      Updated
                      <SortIcon field="updatedAt" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-sm text-muted-foreground">
                      No clients match your filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map(row => {
                    const blocker = deriveBlocker(row.profile);
                    const skus = row.profile.licenseSKUs ?? [];
                    const displayName = row.clientName ?? row.clientEmail;
                    const updatedLabel = row.updatedAt
                      ? new Date(row.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : "—";
                    return (
                      <tr key={row.clientId} className="hover:bg-accent transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{displayName}</p>
                          {row.clientCompany && (
                            <p className="text-xs text-muted-foreground">{row.clientCompany}</p>
                          )}
                          <p className="text-xs text-muted-foreground">{row.clientEmail}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1.5">
                            <ScoreBadge score={readScore(row.profile)} />
                            <ScoreBar score={readScore(row.profile)} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {skus.length === 0 ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {skus.slice(0, 3).map(sku => (
                                <span key={sku} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-accent text-foreground/90 font-mono">
                                  {sku}
                                </span>
                              ))}
                              {skus.length > 3 && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-border/50 text-muted-foreground">
                                  +{skus.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {blocker === "—" ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-400 font-medium">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              None identified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full font-medium">
                              <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                              </svg>
                              {blocker}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {updatedLabel}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Link
                              to={`/crm/clients?m365=${row.clientId}`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-[#006CBE] whitespace-nowrap"
                            >
                              Open M365 profile
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </Link>

                            {confirmDeleteId === row.clientId ? (
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => void handleDelete(row.clientId)}
                                  disabled={deletingId === row.clientId}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 px-2 py-1 rounded-lg transition-colors disabled:opacity-60"
                                >
                                  {deletingId === row.clientId ? (
                                    <div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-1 rounded transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(row.clientId)}
                                title="Delete M365 profile"
                                className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-border bg-card text-xs text-muted-foreground">
            Showing {filtered.length} of {profiles.length} client{profiles.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
