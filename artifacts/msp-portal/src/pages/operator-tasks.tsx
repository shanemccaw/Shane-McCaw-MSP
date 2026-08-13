/**
 * Operator Tasks — list and remediate open operator tasks.
 *
 * Shows tasks created by the portal workflow engine when a node
 * requires manual intervention. Operators can acknowledge or resolve
 * each task and jump directly to the underlying workflow run.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { ConfirmModal } from "@/components/confirm-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus = "open" | "acknowledged" | "resolved";

interface OperatorTask {
  taskId: string;
  runId: string;
  workflowKey: string;
  nodeId: string | null;
  severity: "error" | "warning";
  title: string;
  description: string | null;
  status: TaskStatus;
  mspId: number | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface PagedResponse {
  data: OperatorTask[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<TaskStatus, string> = {
  open: "bg-red-500/15 text-red-400 border-red-500/20",
  acknowledged: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  resolved: "bg-green-500/15 text-green-400 border-green-500/20",
};

const STATUS_ICONS: Record<TaskStatus, React.ElementType> = {
  open: CircleDot,
  acknowledged: AlertTriangle,
  resolved: CheckCircle2,
};

const SEVERITY_COLORS: Record<string, string> = {
  error: "bg-red-500/15 text-red-400 border-red-500/20",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/20",
};

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

export default function OperatorTasksPage() {
  const { fetchWithAuth, user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<TaskStatus>("open");
  const [tasks, setTasks] = useState<OperatorTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{
    taskId: string;
    action: "acknowledged" | "resolved";
  } | null>(null);

  const canAct = user?.mspRole === "PlatformAdmin" || user?.mspRole === "MSPAdmin";

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(
        `/api/msp/v1/portal-wf/operator-tasks?status=${statusFilter}&pageSize=50`,
      );
      if (res.ok) {
        const data = (await res.json()) as PagedResponse;
        setTasks(data.data ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, statusFilter]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  async function updateTask(taskId: string, action: "acknowledged" | "resolved") {
    const res = await fetchWithAuth(
      `/api/msp/v1/portal-wf/operator-tasks/${taskId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action }),
      },
    );
    if (res.ok) {
      toast.success(action === "acknowledged" ? "Task acknowledged" : "Task resolved");
      void fetchTasks();
    }
  }

  const pendingAction = confirm
    ? tasks.find((t) => t.taskId === confirm.taskId)
    : null;

  const actions = (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-muted-foreground"
      onClick={() => void fetchTasks()}
    >
      <RefreshCw className="size-3.5" />
      Refresh
    </Button>
  );

  return (
    <AppShell title="Operator Tasks" actions={actions}>
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">Operator Tasks</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Workflow nodes that require manual intervention.{" "}
              {total > 0 && (
                <span className="font-medium text-foreground">{total} tasks</span>
              )}
            </p>
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as TaskStatus)}
          >
            <SelectTrigger className="w-40 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-md border border-border p-4 space-y-2">
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-3.5 w-48" />
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <CheckCircle2 className="size-8 text-green-500/60" />
            <p className="text-sm text-muted-foreground">
              No {statusFilter} operator tasks.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => {
              const StatusIcon = STATUS_ICONS[task.status];
              return (
                <div
                  key={task.taskId}
                  className="rounded-md border border-border bg-card/60 p-4 flex items-start justify-between gap-4"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <StatusIcon
                      className={`size-4 mt-0.5 shrink-0 ${
                        task.status === "open"
                          ? "text-red-400"
                          : task.status === "acknowledged"
                          ? "text-amber-400"
                          : "text-green-400"
                      }`}
                    />
                    <div className="min-w-0 space-y-1 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{task.title}</p>
                        <Badge
                          variant="outline"
                          className={`text-[10px] capitalize ${SEVERITY_COLORS[task.severity] ?? ""}`}
                        >
                          {task.severity}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`text-[10px] capitalize ${STATUS_COLORS[task.status]}`}
                        >
                          {task.status}
                        </Badge>
                      </div>
                      {task.description && (
                        <p className="text-xs text-muted-foreground">{task.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="font-mono truncate max-w-[180px]">
                          {task.workflowKey}
                        </span>
                        {task.nodeId && (
                          <span className="font-mono truncate max-w-[120px]">
                            node: {task.nodeId}
                          </span>
                        )}
                        <span>{relativeTime(task.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Link href={`/runs/${task.runId}`}>
                      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                        View run
                        <ChevronRight className="size-3" />
                      </Button>
                    </Link>
                    {canAct && task.status === "open" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          setConfirm({ taskId: task.taskId, action: "acknowledged" })
                        }
                      >
                        Acknowledge
                      </Button>
                    )}
                    {canAct && task.status !== "resolved" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-green-400 border-green-500/30 hover:bg-green-500/10"
                        onClick={() =>
                          setConfirm({ taskId: task.taskId, action: "resolved" })
                        }
                      >
                        Resolve
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {confirm && pendingAction && (
        <ConfirmModal
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={
            confirm.action === "acknowledged"
              ? "Acknowledge task"
              : "Resolve task"
          }
          description={
            confirm.action === "acknowledged"
              ? `Mark "${pendingAction.title}" as acknowledged? It will remain visible until resolved.`
              : `Mark "${pendingAction.title}" as resolved? This indicates the issue has been handled.`
          }
          confirmLabel={confirm.action === "acknowledged" ? "Acknowledge" : "Resolve"}
          onConfirm={() => updateTask(confirm.taskId, confirm.action)}
        />
      )}
    </AppShell>
  );
}
