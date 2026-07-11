/**
 * Workflow Runs — list portal workflow runs with filtering and deep links.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface PortalWfRun {
  id: number;
  runId: string;
  workflowKey: string;
  tenantContext: Record<string, unknown>;
  status: RunStatus;
  triggerEventType: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  mspId: number | null;
  customerId: number | null;
  createdAt: string;
}

interface PagedResponse {
  data: PortalWfRun[];
  total: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<RunStatus, string> = {
  pending: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  running: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  completed: "bg-green-500/15 text-green-400 border-green-500/20",
  failed: "bg-red-500/15 text-red-400 border-red-500/20",
  cancelled: "bg-amber-500/15 text-amber-400 border-amber-500/20",
};

const STATUS_ICONS: Record<RunStatus, React.ElementType> = {
  pending: CircleDot,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
};

function duration(run: PortalWfRun): string {
  const start = run.startedAt ? new Date(run.startedAt) : new Date(run.createdAt);
  const end = run.completedAt ? new Date(run.completedAt) : new Date();
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RunsPage() {
  const { fetchWithAuth } = useAuth();
  const [statusFilter, setStatusFilter] = useState<RunStatus | "all">("all");
  const [wfFilter, setWfFilter] = useState("");
  const [runs, setRuns] = useState<PortalWfRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "50", sortBy: "createdAt", sortDir: "desc" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (wfFilter.trim()) params.set("workflowKey", wfFilter.trim());

      const res = await fetchWithAuth(`/api/msp/v1/portal-wf/runs?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as PagedResponse;
        setRuns(data.data ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, statusFilter, wfFilter]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  const actions = (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-muted-foreground"
      onClick={() => void fetchRuns()}
    >
      <RefreshCw className="size-3.5" />
      Refresh
    </Button>
  );

  return (
    <AppShell title="Workflow Runs" actions={actions}>
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">Workflow Runs</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Portal workflow execution history.{" "}
              {total > 0 && (
                <span className="font-medium text-foreground">{total} runs</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Filter by workflow key…"
              value={wfFilter}
              onChange={(e) => setWfFilter(e.target.value)}
              className="h-8 text-sm w-52"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as RunStatus | "all")}
            >
              <SelectTrigger className="w-36 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-md border border-border p-4 space-y-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3.5 w-36" />
              </div>
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <p className="text-sm text-muted-foreground">No workflow runs found.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => {
              const StatusIcon = STATUS_ICONS[run.status];
              return (
                <div
                  key={run.runId}
                  className="rounded-md border border-border bg-card/60 p-4 flex items-start justify-between gap-4"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <StatusIcon
                      className={`size-4 mt-0.5 shrink-0 ${
                        run.status === "completed"
                          ? "text-green-400"
                          : run.status === "failed"
                          ? "text-red-400"
                          : run.status === "running"
                          ? "text-blue-400 animate-spin"
                          : run.status === "cancelled"
                          ? "text-amber-400"
                          : "text-zinc-400"
                      }`}
                    />
                    <div className="min-w-0 space-y-1 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium font-mono truncate max-w-[240px]">
                          {run.workflowKey}
                        </p>
                        <Badge
                          variant="outline"
                          className={`text-[10px] capitalize ${STATUS_COLORS[run.status]}`}
                        >
                          {run.status}
                        </Badge>
                      </div>
                      {run.errorMessage && (
                        <p className="text-xs text-destructive-foreground truncate">
                          {run.errorMessage}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="font-mono truncate max-w-[140px]">
                          {run.runId.slice(0, 8)}…
                        </span>
                        {run.triggerEventType && (
                          <span className="truncate max-w-[160px]">
                            via {run.triggerEventType}
                          </span>
                        )}
                        <span>
                          {duration(run)}{" "}
                          {run.completedAt ? "total" : "elapsed"}
                        </span>
                        <span>{relativeTime(run.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <Link href={`/runs/${run.runId}`}>
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs shrink-0">
                      Details
                      <ChevronRight className="size-3" />
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
