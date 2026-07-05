import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation, useSearch } from "wouter";
import { format, formatDistanceToNow } from "date-fns";

// ── Event catalog (compact — category + name only) ─────────────────────────────
const EVENT_CATALOG: Array<{ category: string; name: string }> = [
  { category: "CRM",        name: "lead.created" },
  { category: "CRM",        name: "lead.qualified" },
  { category: "CRM",        name: "opportunity.created" },
  { category: "CRM",        name: "client.created" },
  { category: "CRM",        name: "project.created" },
  { category: "CRM",        name: "project.phase_changed" },
  { category: "CRM",        name: "onboarding.complete" },
  { category: "CRM",        name: "sow.scope_reduced" },
  { category: "CRM",        name: "contract.signed" },
  { category: "Payments",   name: "payment.received" },
  { category: "Payments",   name: "agreement_signed" },
  { category: "Payments",   name: "phase_completed" },
  { category: "Scheduling", name: "phase.delivery_date_changed" },
  { category: "Scheduling", name: "milestone.delivery_date_changed" },
  { category: "M365",       name: "m365.health_check_complete" },
  { category: "M365",       name: "m365.diagnostic_failed" },
  { category: "M365",       name: "quiz.lead_submitted" },
  { category: "M365",       name: "customer.script_result" },
];

const EVENT_CATEGORIES = ["CRM", "Payments", "Scheduling", "M365"] as const;
type EventCategory = (typeof EVENT_CATEGORIES)[number];

interface WfRun {
  id: number;
  definitionId: number;
  definitionName: string | null;
  isSystem: boolean;
  versionLabel: string | null;
  triggerType: string;
  triggerRef: string | null;
  status: string;
  durationMs: number | null;
  startedAt: string | null;
  createdAt: string;
}

interface PendingApproval {
  id: number;
  runId: number;
  nodeId: string;
  expiresAt: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  completed:          "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  running:            "bg-blue-500/20 text-blue-300 border-blue-500/30",
  failed:             "bg-red-500/20 text-red-400 border-red-500/30",
  pending:            "bg-amber-500/20 text-amber-400 border-amber-500/30",
  cancelled:          "bg-[#30363D] text-[#7D8590] border-[#30363D]",
  awaiting_approval:  "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
};

const TRIGGER_ICONS: Record<string, string> = {
  manual:   "🖱",
  schedule: "📅",
  webhook:  "🔗",
  event:    "📡",
};

const CATEGORY_STYLES: Record<EventCategory, string> = {
  CRM:        "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Payments:   "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  Scheduling: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  M365:       "bg-violet-500/20 text-violet-300 border-violet-500/30",
};

function getEventCategory(eventName: string): EventCategory | null {
  return EVENT_CATALOG.find(e => e.name === eventName)?.category as EventCategory | null ?? null;
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_STYLES[status] ?? "bg-[#1C2128] text-[#7D8590] border-[#30363D]"}`}>
      {status === "awaiting_approval" ? "⏸ approval" : status}
    </span>
  );
}

function fmtDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

const GRID = "grid grid-cols-[2rem_1fr_8rem_7rem_6rem_6rem_5rem] gap-4";

function RunRow({
  run,
  approval,
  onClick,
  onApprove,
  onReject,
  isDeciding,
}: {
  run: WfRun;
  approval?: PendingApproval;
  onClick: () => void;
  onApprove?: (approvalId: number) => void;
  onReject?: (approvalId: number) => void;
  isDeciding?: boolean;
}) {
  const isAwaitingApproval = run.status === "awaiting_approval" && approval;

  return (
    <div className="border-b border-[#30363D]/50">
      <div
        className={`${GRID} px-4 py-3 hover:bg-[#1C2128] transition-colors cursor-pointer items-center`}
        onClick={onClick}
      >
        <span className="text-xs text-[#484F58] font-mono">{run.id}</span>

        <div className="min-w-0">
          <p className="text-sm font-medium text-[#E6EDF3] truncate">{run.definitionName ?? "—"}</p>
          {run.versionLabel && (
            <p className="text-[10px] text-[#484F58] truncate">{run.versionLabel}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {run.triggerType === "event" && run.triggerRef && run.triggerRef !== "draft_test" ? (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="flex items-center gap-1">
                <span className="text-sm mr-0.5">{TRIGGER_ICONS.event}</span>
                <span className="text-xs text-[#E6EDF3] font-mono truncate">{run.triggerRef}</span>
              </span>
              {(() => {
                const cat = getEventCategory(run.triggerRef);
                return cat ? (
                  <span className={`inline-flex items-center self-start px-1.5 py-0.5 rounded text-[9px] font-semibold border ${CATEGORY_STYLES[cat]}`}>
                    {cat}
                  </span>
                ) : null;
              })()}
            </div>
          ) : (
            <span className="text-sm">
              <span className="mr-1">{TRIGGER_ICONS[run.triggerType] ?? "•"}</span>
              <span className="text-xs text-[#7D8590] capitalize">{run.triggerType}</span>
            </span>
          )}
          {run.triggerRef === "draft_test" && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase tracking-wider">Draft</span>
          )}
        </div>

        <StatusChip status={run.status} />

        <span className="text-xs text-[#7D8590]">
          {run.startedAt ? formatDistanceToNow(new Date(run.startedAt), { addSuffix: true }) : format(new Date(run.createdAt), "MMM d HH:mm")}
        </span>

        <span className="text-xs text-[#7D8590] font-mono">{fmtDuration(run.durationMs)}</span>

        <svg className="w-4 h-4 text-[#484F58]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* Inline approval actions */}
      {isAwaitingApproval && (
        <div
          className="flex items-center gap-3 px-4 pb-3 -mt-1"
          onClick={e => e.stopPropagation()}
        >
          <span className="text-[10px] text-yellow-400/70 flex-1">
            ⏸ Awaiting admin approval
            {approval.expiresAt && ` · expires ${format(new Date(approval.expiresAt), "MMM d, HH:mm")}`}
          </span>
          <button
            onClick={() => onApprove?.(approval.id)}
            disabled={isDeciding}
            className="px-2.5 py-1 bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-50 text-white text-[10px] font-semibold rounded-lg transition-colors"
          >
            ✓ Approve
          </button>
          <button
            onClick={() => onReject?.(approval.id)}
            disabled={isDeciding}
            className="px-2.5 py-1 bg-red-600/70 hover:bg-red-600 disabled:opacity-50 text-white text-[10px] font-semibold rounded-lg transition-colors"
          >
            ✕ Reject
          </button>
        </div>
      )}
    </div>
  );
}

export default function RunHistoryPage({ initialDefinitionId, onClose }: { initialDefinitionId?: number; onClose?: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [location, navigate] = useLocation();
  const searchStr = useSearch();
  const qc = useQueryClient();
  const [systemExpanded, setSystemExpanded] = useState(false);

  // ── Parse filter state from URL search params ──────────────────────────────
  const sp = new URLSearchParams(searchStr);
  const defIdFilter    = Number(sp.get("wf") ?? initialDefinitionId ?? 0);
  const statusFilter   = sp.get("status") ?? "";
  const fromDate       = sp.get("from") ?? "";
  const toDate         = sp.get("to") ?? "";
  const triggerTypeFilter   = sp.get("trigger") ?? "";
  const eventCategoryFilter = (sp.get("category") ?? "") as EventCategory | "";
  const eventNameFilter     = sp.get("event") ?? "";
  const offset              = Number(sp.get("offset") ?? 0);

  // Seed the URL with initialDefinitionId on first mount if no wf param yet
  useEffect(() => {
    if (initialDefinitionId && !sp.has("wf")) {
      const next = new URLSearchParams(searchStr);
      next.set("wf", String(initialDefinitionId));
      navigate(`${location}?${next.toString()}`, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes inline run history panel
  useEffect(() => {
    if (!onClose) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose!();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // ── Helper: update one or more params, always reset offset unless explicitly set
  function setFilters(patch: Record<string, string | number | null>, resetOffset = true) {
    const next = new URLSearchParams(searchStr);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "" || value === 0) {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    }
    if (resetOffset) next.delete("offset");
    const qs = next.toString();
    navigate(`${location}${qs ? `?${qs}` : ""}`, { replace: true });
  }

  // Reject modal state
  const [rejectApprovalId, setRejectApprovalId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const limit = 30;

  // Events for the currently-selected category
  const categoryEvents = eventCategoryFilter
    ? EVENT_CATALOG.filter(e => e.category === eventCategoryFilter)
    : [];

  const params = new URLSearchParams();
  if (defIdFilter) params.set("definitionId", String(defIdFilter));
  if (statusFilter) params.set("status", statusFilter);
  if (fromDate) params.set("from", fromDate);
  if (toDate)   params.set("to",   toDate);
  if (triggerTypeFilter) params.set("triggerType", triggerTypeFilter);
  if (triggerTypeFilter === "event") {
    if (eventNameFilter) {
      params.set("triggerRef", eventNameFilter);
    } else if (eventCategoryFilter) {
      const names = EVENT_CATALOG.filter(e => e.category === eventCategoryFilter).map(e => e.name);
      if (names.length > 0) params.set("triggerRefs", names.join(","));
    }
  }
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const { data, isLoading } = useQuery<{ runs: WfRun[]; total: number }>({
    queryKey: ["wf-runs", defIdFilter, statusFilter, fromDate, toDate, triggerTypeFilter, eventCategoryFilter, eventNameFilter, offset],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs?${params}`);
      if (!res.ok) throw new Error("Failed to load runs");
      return res.json();
    },
  });

  const { data: defs = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["wf-definitions"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/workflows/definitions");
      return res.json();
    },
  });

  // Fetch pending approvals when any visible run is awaiting_approval
  const allRuns = data?.runs ?? [];
  const hasAwaitingApproval = allRuns.some(r => r.status === "awaiting_approval");

  const { data: pendingApprovals = [] } = useQuery<PendingApproval[]>({
    queryKey: ["wf-pending-approvals-list"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/workflows/pending-approvals");
      if (!res.ok) return [];
      const all = await res.json() as Array<PendingApproval & { run_id?: number }>;
      return all.map(a => ({
        ...a,
        runId: (a as unknown as { runId?: number }).runId ?? a.run_id ?? 0,
      }));
    },
    enabled: hasAwaitingApproval,
    refetchInterval: hasAwaitingApproval ? 10_000 : false,
  });

  const approvalByRunId = new Map(pendingApprovals.map(a => [a.runId, a]));

  const decideMut = useMutation({
    mutationFn: async ({ approvalId, decision, note }: { approvalId: number; decision: "approved" | "rejected"; note?: string }) => {
      const res = await fetchWithAuth(`/api/admin/workflows/pending-approvals/${approvalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      if (!res.ok) throw new Error("Failed to decide");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wf-runs"] });
      qc.invalidateQueries({ queryKey: ["wf-pending-approvals-list"] });
      setRejectApprovalId(null);
      setRejectNote("");
    },
  });

  const total = data?.total ?? 0;
  const userRuns = allRuns.filter(r => !r.isSystem);
  const systemRuns = allRuns.filter(r => r.isSystem);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#E6EDF3]">Run History</h1>
            <p className="text-sm text-[#7D8590] mt-0.5">{total} total runs</p>
          </div>
          <button
            onClick={() => onClose ? onClose() : navigate("/workflows/list")}
            className="text-xs text-[#7D8590] hover:text-[#E6EDF3] flex items-center gap-1.5 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {onClose ? "Back" : "All Workflows"}
          </button>
        </div>

        {/* Filters */}
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={defIdFilter}
              onChange={e => setFilters({ wf: Number(e.target.value) || null })}
              className="bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-1.5 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
            >
              <option value={0}>All Workflows</option>
              {defs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={e => setFilters({ status: e.target.value || null })}
              className="bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-1.5 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
            >
              <option value="">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="running">Running</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
              <option value="cancelled">Cancelled</option>
              <option value="awaiting_approval">Awaiting Approval</option>
            </select>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#484F58]">From</span>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFilters({ from: e.target.value || null })}
                className="bg-[#161B22] border border-[#30363D] rounded-lg px-2 py-1.5 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 [color-scheme:dark]"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#484F58]">To</span>
              <input
                type="date"
                value={toDate}
                onChange={e => setFilters({ to: e.target.value || null })}
                className="bg-[#161B22] border border-[#30363D] rounded-lg px-2 py-1.5 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 [color-scheme:dark]"
              />
            </div>
            {(fromDate || toDate) && (
              <button
                onClick={() => setFilters({ from: null, to: null })}
                className="text-xs text-[#484F58] hover:text-[#E6EDF3] transition-colors"
              >
                Clear dates
              </button>
            )}
          </div>

          {/* Trigger / event filter row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#484F58]">Trigger</span>
              <select
                value={triggerTypeFilter}
                onChange={e => setFilters({ trigger: e.target.value || null, category: null, event: null })}
                className="bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-1.5 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              >
                <option value="">All Triggers</option>
                <option value="manual">🖱 Manual</option>
                <option value="schedule">📅 Schedule</option>
                <option value="webhook">🔗 Webhook</option>
                <option value="event">📡 Event</option>
              </select>
            </div>

            {triggerTypeFilter === "event" && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[#484F58]">Category</span>
                  <select
                    value={eventCategoryFilter}
                    onChange={e => setFilters({ category: e.target.value || null, event: null })}
                    className="bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-1.5 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
                  >
                    <option value="">All Categories</option>
                    {EVENT_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                {eventCategoryFilter && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[#484F58]">Event</span>
                    <select
                      value={eventNameFilter}
                      onChange={e => setFilters({ event: e.target.value || null })}
                      className="bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-1.5 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
                    >
                      <option value="">All {eventCategoryFilter} Events</option>
                      {categoryEvents.map(ev => (
                        <option key={ev.name} value={ev.name}>{ev.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            {(triggerTypeFilter || eventCategoryFilter || eventNameFilter) && (
              <button
                onClick={() => setFilters({ trigger: null, category: null, event: null })}
                className="text-xs text-[#484F58] hover:text-[#E6EDF3] transition-colors"
              >
                Clear trigger
              </button>
            )}
          </div>
        </div>

        {/* Table header */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
          <div className={`${GRID} px-4 py-2.5 border-b border-[#30363D] text-xs font-semibold text-[#484F58] uppercase tracking-wider`}>
            <span>#</span>
            <span>Workflow</span>
            <span>Trigger</span>
            <span>Status</span>
            <span>Started</span>
            <span>Duration</span>
            <span></span>
          </div>

          {isLoading ? (
            <div className="space-y-px">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-12 bg-[#0D1117]/40 animate-pulse" />
              ))}
            </div>
          ) : allRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-[#7D8590] font-medium">No runs yet</p>
              <p className="text-sm text-[#484F58] mt-1">Trigger a workflow manually or via a schedule.</p>
            </div>
          ) : (
            <>
              {/* User workflow runs */}
              {userRuns.map(run => (
                <RunRow
                  key={run.id}
                  run={run}
                  approval={approvalByRunId.get(run.id)}
                  onClick={() => navigate(`/workflows/runs/${run.id}`)}
                  onApprove={approvalId => decideMut.mutate({ approvalId, decision: "approved" })}
                  onReject={approvalId => { setRejectApprovalId(approvalId); }}
                  isDeciding={decideMut.isPending}
                />
              ))}

              {/* System runs — collapsed by default */}
              {systemRuns.length > 0 && (
                <>
                  <button
                    onClick={() => setSystemExpanded(v => !v)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 border-b border-[#30363D]/50 hover:bg-[#1C2128] transition-colors text-left"
                  >
                    <svg
                      className={`w-3 h-3 text-[#484F58] transition-transform flex-shrink-0 ${systemExpanded ? "rotate-90" : ""}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <svg className="w-3.5 h-3.5 text-violet-400/70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-xs font-semibold text-[#484F58]">System runs</span>
                    <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#21262D] border border-[#30363D] text-[10px] font-bold text-[#7D8590]">
                      {systemRuns.length}
                    </span>
                  </button>

                  {systemExpanded && systemRuns.map(run => (
                    <RunRow
                      key={run.id}
                      run={run}
                      approval={approvalByRunId.get(run.id)}
                      onClick={() => navigate(`/workflows/runs/${run.id}`)}
                      onApprove={approvalId => decideMut.mutate({ approvalId, decision: "approved" })}
                      onReject={approvalId => { setRejectApprovalId(approvalId); }}
                      isDeciding={decideMut.isPending}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#7D8590]">
              Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setFilters({ offset: Math.max(0, offset - limit) || null }, false)}
                disabled={offset === 0}
                className="px-3 py-1.5 text-xs bg-[#161B22] border border-[#30363D] text-[#7D8590] disabled:opacity-40 rounded-lg hover:text-[#E6EDF3] transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setFilters({ offset: offset + limit }, false)}
                disabled={offset + limit >= total}
                className="px-3 py-1.5 text-xs bg-[#161B22] border border-[#30363D] text-[#7D8590] disabled:opacity-40 rounded-lg hover:text-[#E6EDF3] transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {rejectApprovalId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 w-full max-w-md space-y-4">
            <h2 className="text-base font-bold text-[#E6EDF3]">Reject Approval</h2>
            <p className="text-sm text-[#7D8590]">
              This will fail the workflow run. Optionally provide a reason.
            </p>
            <textarea
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              placeholder="Reason for rejection (optional)"
              rows={3}
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-red-500/60 placeholder-[#484F58] resize-none"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setRejectApprovalId(null); setRejectNote(""); }}
                className="px-4 py-2 bg-[#1C2128] hover:bg-[#30363D] text-[#E6EDF3] text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => decideMut.mutate({ approvalId: rejectApprovalId, decision: "rejected", note: rejectNote || undefined })}
                disabled={decideMut.isPending}
                className="px-4 py-2 bg-red-600/80 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {decideMut.isPending ? "Rejecting…" : "Reject Run"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
