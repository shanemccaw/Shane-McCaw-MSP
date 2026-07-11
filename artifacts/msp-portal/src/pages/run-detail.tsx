/**
 * Run Detail — read-only node-by-node view of a portal workflow run.
 *
 * Operators can inspect every node's status, input/output payload,
 * and error details. MSPAdmins can manually retry or cancel the run.
 */

import { useState, useEffect, useCallback } from "react";
import { Link, useParams } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { ConfirmModal } from "@/components/confirm-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Loader2,
  RefreshCw,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

interface PortalWfRun {
  id: number;
  runId: string;
  workflowKey: string;
  tenantContext: Record<string, unknown>;
  status: RunStatus;
  triggerEventType: string | null;
  inputPayload: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  mspId: number | null;
  customerId: number | null;
  createdAt: string;
}

interface NodeOutput {
  id: number;
  runId: string;
  nodeId: string;
  nodeType: string;
  status: NodeStatus;
  attemptCount: number;
  inputPayload: Record<string, unknown> | null;
  outputPayload: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface RunDetailResponse {
  run: PortalWfRun;
  nodeOutputs: NodeOutput[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<RunStatus | NodeStatus, string> = {
  pending: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  running: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  completed: "bg-green-500/15 text-green-400 border-green-500/20",
  failed: "bg-red-500/15 text-red-400 border-red-500/20",
  cancelled: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  skipped: "bg-zinc-500/10 text-zinc-500 border-zinc-500/10",
};

const STATUS_ICONS: Record<RunStatus | NodeStatus, React.ElementType> = {
  pending: CircleDot,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
  skipped: ChevronRight,
};

function duration(startedAt: string | null, completedAt: string | null, createdAt: string): string {
  const start = startedAt ? new Date(startedAt) : new Date(createdAt);
  const end = completedAt ? new Date(completedAt) : new Date();
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

// ── Node card ─────────────────────────────────────────────────────────────────

function NodeCard({ node }: { node: NodeOutput }) {
  const [open, setOpen] = useState(node.status === "failed");
  const StatusIcon = STATUS_ICONS[node.status];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border border-border bg-card/60">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/30 transition-colors rounded-md">
            <StatusIcon
              className={`size-4 mt-0.5 shrink-0 ${
                node.status === "completed"
                  ? "text-green-400"
                  : node.status === "failed"
                  ? "text-red-400"
                  : node.status === "running"
                  ? "text-blue-400 animate-spin"
                  : node.status === "skipped"
                  ? "text-zinc-500"
                  : "text-zinc-400"
              }`}
            />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium font-mono">{node.nodeId}</p>
                <Badge
                  variant="outline"
                  className="text-[10px] text-muted-foreground"
                >
                  {node.nodeType}
                </Badge>
                <Badge
                  variant="outline"
                  className={`text-[10px] capitalize ${STATUS_COLORS[node.status]}`}
                >
                  {node.status}
                </Badge>
              </div>
              {node.errorMessage && (
                <p className="text-xs text-destructive-foreground truncate">
                  {node.errorMessage}
                </p>
              )}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span>{node.attemptCount} attempt{node.attemptCount !== 1 ? "s" : ""}</span>
                <span>{duration(node.startedAt, node.completedAt, node.createdAt)}</span>
              </div>
            </div>
            <ChevronDown
              className={`size-4 shrink-0 mt-0.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
            {node.errorMessage && (
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <AlertTriangle className="size-3 text-red-400" />
                  Error
                </p>
                <pre className="rounded bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive-foreground overflow-auto whitespace-pre-wrap">
                  {node.errorMessage}
                </pre>
              </div>
            )}
            {node.inputPayload && Object.keys(node.inputPayload).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Input payload</p>
                <pre className="rounded bg-muted px-3 py-2 text-[11px] overflow-auto whitespace-pre-wrap max-h-40">
                  {JSON.stringify(node.inputPayload, null, 2)}
                </pre>
              </div>
            )}
            {node.outputPayload && Object.keys(node.outputPayload).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Output payload</p>
                <pre className="rounded bg-muted px-3 py-2 text-[11px] overflow-auto whitespace-pre-wrap max-h-40">
                  {JSON.stringify(node.outputPayload, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const { fetchWithAuth, user } = useAuth();
  const [data, setData] = useState<RunDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<"retry" | "cancel" | null>(null);

  const canAct = user?.mspRole === "PlatformAdmin" || user?.mspRole === "MSPAdmin";

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/msp/v1/portal-wf/runs/${runId}`);
      if (res.ok) {
        const json = (await res.json()) as RunDetailResponse;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, runId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  async function handleRetry() {
    const res = await fetchWithAuth(`/api/msp/v1/portal-wf/runs/${runId}/retry`, {
      method: "POST",
    });
    if (res.ok) {
      const json = (await res.json()) as { newRunId?: string };
      toast.success(`Retried — new run ${json.newRunId?.slice(0, 8) ?? ""}`);
      void fetchData();
    }
  }

  async function handleCancel() {
    const res = await fetchWithAuth(`/api/msp/v1/portal-wf/runs/${runId}/cancel`, {
      method: "POST",
    });
    if (res.ok) {
      toast.success("Run cancelled");
      void fetchData();
    }
  }

  const run = data?.run;
  const RunStatusIcon = run ? STATUS_ICONS[run.status] : CircleDot;

  const actions = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => void fetchData()}
      >
        <RefreshCw className="size-3.5" />
        Refresh
      </Button>
      {canAct && run?.status === "failed" && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
          onClick={() => setConfirm("retry")}
        >
          <RotateCcw className="size-3" />
          Retry run
        </Button>
      )}
      {canAct && run?.status === "pending" && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
          onClick={() => setConfirm("cancel")}
        >
          Cancel run
        </Button>
      )}
    </div>
  );

  return (
    <AppShell title="Run Detail" actions={actions}>
      <div className="p-6 space-y-5">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/runs">
            <button className="hover:text-foreground transition-colors flex items-center gap-1">
              <ChevronLeft className="size-3" />
              Workflow Runs
            </button>
          </Link>
          <ChevronRight className="size-3" />
          <span className="text-foreground font-mono truncate max-w-[200px]">
            {runId?.slice(0, 8)}…
          </span>
        </nav>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
            <div className="space-y-2 pt-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          </div>
        ) : !data ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <XCircle className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Run not found.</p>
          </div>
        ) : (
          <>
            {/* Run summary */}
            <div className="rounded-md border border-border bg-card/60 p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <RunStatusIcon
                      className={`size-4 shrink-0 ${
                        run!.status === "completed"
                          ? "text-green-400"
                          : run!.status === "failed"
                          ? "text-red-400"
                          : run!.status === "running"
                          ? "text-blue-400 animate-spin"
                          : run!.status === "cancelled"
                          ? "text-amber-400"
                          : "text-zinc-400"
                      }`}
                    />
                    <h2 className="text-base font-semibold font-mono">{run!.workflowKey}</h2>
                    <Badge
                      variant="outline"
                      className={`text-[10px] capitalize ${STATUS_COLORS[run!.status]}`}
                    >
                      {run!.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{run!.runId}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground mb-0.5">Created</p>
                  <p>{new Date(run!.createdAt).toLocaleString()}</p>
                </div>
                {run!.startedAt && (
                  <div>
                    <p className="text-muted-foreground mb-0.5">Started</p>
                    <p>{new Date(run!.startedAt).toLocaleString()}</p>
                  </div>
                )}
                {run!.completedAt && (
                  <div>
                    <p className="text-muted-foreground mb-0.5">Completed</p>
                    <p>{new Date(run!.completedAt).toLocaleString()}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground mb-0.5">Duration</p>
                  <p>{duration(run!.startedAt, run!.completedAt, run!.createdAt)}</p>
                </div>
                {run!.triggerEventType && (
                  <div>
                    <p className="text-muted-foreground mb-0.5">Trigger</p>
                    <p className="font-mono truncate">{run!.triggerEventType}</p>
                  </div>
                )}
                {(run!.mspId || run!.customerId) && (
                  <div>
                    <p className="text-muted-foreground mb-0.5">Tenant</p>
                    <p>
                      {run!.mspId ? `MSP ${run!.mspId}` : ""}
                      {run!.mspId && run!.customerId ? " / " : ""}
                      {run!.customerId ? `Customer ${run!.customerId}` : ""}
                    </p>
                  </div>
                )}
              </div>

              {run!.errorMessage && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <AlertTriangle className="size-3 text-red-400" />
                    Run error
                  </p>
                  <pre className="rounded bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive-foreground overflow-auto whitespace-pre-wrap">
                    {run!.errorMessage}
                  </pre>
                </div>
              )}

              {run!.output && Object.keys(run!.output).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Run output</p>
                  <pre className="rounded bg-muted px-3 py-2 text-[11px] overflow-auto whitespace-pre-wrap max-h-32">
                    {JSON.stringify(run!.output, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Node outputs */}
            <div>
              <h3 className="text-sm font-semibold mb-3">
                Nodes ({data.nodeOutputs.length})
              </h3>
              {data.nodeOutputs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No node outputs recorded yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.nodeOutputs.map((node) => (
                    <NodeCard key={node.id} node={node} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {confirm === "retry" && (
        <ConfirmModal
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Retry workflow run"
          description="This creates a new run from the same input payload. The original run is not modified."
          confirmLabel="Retry"
          onConfirm={handleRetry}
        />
      )}
      {confirm === "cancel" && (
        <ConfirmModal
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Cancel workflow run"
          description="The run will be cancelled immediately. This cannot be undone."
          confirmLabel="Cancel run"
          variant="destructive"
          onConfirm={handleCancel}
        />
      )}
    </AppShell>
  );
}
