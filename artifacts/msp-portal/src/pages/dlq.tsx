/**
 * DLQ Browser — inspect, replay, or resolve Dead Letter Queue entries.
 *
 * Shows failed events from the portal workflow event bus. Operators
 * can replay an entry (creates a new workflow run) or mark it as
 * discarded / manually handled.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { ConfirmModal } from "@/components/confirm-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, CheckCircle2, RefreshCw, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type DlqResolution = "replayed" | "discarded" | "manual";

interface DlqEntry {
  id: number;
  dlqId: string;
  sourceEventId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  errorMessage: string;
  errorStack: string | null;
  attemptCount: number;
  lastAttemptAt: string;
  resolvedAt: string | null;
  resolution: DlqResolution | null;
  mspId: number | null;
  customerId: number | null;
  createdAt: string;
}

interface PagedResponse {
  data: DlqEntry[];
  total: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RESOLUTION_COLORS: Record<DlqResolution, string> = {
  replayed: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  discarded: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  manual: "bg-green-500/15 text-green-400 border-green-500/20",
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

// ── Detail drawer ─────────────────────────────────────────────────────────────

function DlqDetailDialog({
  entry,
  onClose,
}: {
  entry: DlqEntry;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">DLQ Entry Detail</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Event type</p>
              <p className="font-mono text-xs">{entry.eventType}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Attempts</p>
              <p>{entry.attemptCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">DLQ ID</p>
              <p className="font-mono text-xs truncate">{entry.dlqId}</p>
            </div>
            {entry.sourceEventId && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Source event</p>
                <p className="font-mono text-xs truncate">{entry.sourceEventId}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Created</p>
              <p>{new Date(entry.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Last attempt</p>
              <p>{new Date(entry.lastAttemptAt).toLocaleString()}</p>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">Error</p>
            <pre className="rounded bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive-foreground overflow-auto whitespace-pre-wrap">
              {entry.errorMessage}
            </pre>
          </div>

          {entry.errorStack && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Stack trace</p>
              <pre className="rounded bg-muted px-3 py-2 text-[11px] overflow-auto whitespace-pre-wrap max-h-40">
                {entry.errorStack}
              </pre>
            </div>
          )}

          <div>
            <p className="text-xs text-muted-foreground mb-1">Payload</p>
            <pre className="rounded bg-muted px-3 py-2 text-[11px] overflow-auto whitespace-pre-wrap max-h-40">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DlqPage() {
  const { fetchWithAuth, user } = useAuth();
  const [resolvedFilter, setResolvedFilter] = useState<"all" | "open" | "resolved">("open");
  const [entries, setEntries] = useState<DlqEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<DlqEntry | null>(null);
  const [confirm, setConfirm] = useState<{
    entry: DlqEntry;
    action: "replay" | "discard" | "manual";
  } | null>(null);

  const canAct = user?.mspRole === "PlatformAdmin" || user?.mspRole === "MSPAdmin";

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const resolvedParam =
        resolvedFilter === "open"
          ? "resolved=false"
          : resolvedFilter === "resolved"
          ? "resolved=true"
          : "";
      const res = await fetchWithAuth(
        `/api/msp/v1/portal-wf/dlq?pageSize=50${resolvedParam ? `&${resolvedParam}` : ""}`,
      );
      if (res.ok) {
        const data = (await res.json()) as PagedResponse;
        setEntries(data.data ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, resolvedFilter]);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  async function handleReplay(dlqId: string) {
    const res = await fetchWithAuth(
      `/api/msp/v1/portal-wf/dlq/${dlqId}/replay`,
      { method: "POST" },
    );
    if (res.ok) {
      const data = (await res.json()) as { newRunId?: string };
      toast.success(`Replayed — new run ${data.newRunId?.slice(0, 8) ?? ""}`);
      void fetchEntries();
    }
  }

  async function handleResolve(dlqId: string, resolution: "discarded" | "manual") {
    const res = await fetchWithAuth(
      `/api/msp/v1/portal-wf/dlq/${dlqId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      },
    );
    if (res.ok) {
      toast.success(
        resolution === "discarded" ? "Entry discarded" : "Marked as manually resolved",
      );
      void fetchEntries();
    }
  }

  const actions = (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-muted-foreground"
      onClick={() => void fetchEntries()}
    >
      <RefreshCw className="size-3.5" />
      Refresh
    </Button>
  );

  return (
    <AppShell title="Dead Letter Queue" actions={actions}>
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">Dead Letter Queue</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Failed events from the portal workflow engine.{" "}
              {total > 0 && (
                <span className="font-medium text-foreground">{total} entries</span>
              )}
            </p>
          </div>
          <Select
            value={resolvedFilter}
            onValueChange={(v) => setResolvedFilter(v as typeof resolvedFilter)}
          >
            <SelectTrigger className="w-40 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Unresolved</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-md border border-border p-4 space-y-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3.5 w-40" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <CheckCircle2 className="size-8 text-green-500/60" />
            <p className="text-sm text-muted-foreground">No DLQ entries.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.dlqId}
                className="rounded-md border border-border bg-card/60 p-4 flex items-start justify-between gap-4"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {entry.resolvedAt ? (
                    <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-green-400" />
                  ) : (
                    <AlertCircle className="size-4 mt-0.5 shrink-0 text-red-400" />
                  )}
                  <div className="min-w-0 space-y-1 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium font-mono truncate max-w-[260px]">
                        {entry.eventType}
                      </p>
                      {entry.resolution && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] capitalize ${RESOLUTION_COLORS[entry.resolution]}`}
                        >
                          {entry.resolution}
                        </Badge>
                      )}
                      {!entry.resolvedAt && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-red-500/15 text-red-400 border-red-500/20"
                        >
                          unresolved
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-destructive-foreground truncate">
                      {entry.errorMessage}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span>{entry.attemptCount} attempt{entry.attemptCount !== 1 ? "s" : ""}</span>
                      <span>{relativeTime(entry.createdAt)}</span>
                      {entry.resolvedAt && (
                        <span>resolved {relativeTime(entry.resolvedAt)}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setDetail(entry)}
                  >
                    Inspect
                  </Button>
                  {canAct && !entry.resolvedAt && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                        onClick={() =>
                          setConfirm({ entry, action: "replay" })
                        }
                      >
                        <RotateCcw className="size-3" />
                        Replay
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs text-zinc-400 border-zinc-500/30 hover:bg-zinc-500/10"
                        onClick={() =>
                          setConfirm({ entry, action: "discard" })
                        }
                      >
                        <X className="size-3" />
                        Discard
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-green-400 border-green-500/30 hover:bg-green-500/10"
                        onClick={() =>
                          setConfirm({ entry, action: "manual" })
                        }
                      >
                        Escalate
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {detail && (
        <DlqDetailDialog entry={detail} onClose={() => setDetail(null)} />
      )}

      {confirm && (
        <ConfirmModal
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={
            confirm.action === "replay"
              ? "Replay DLQ entry"
              : confirm.action === "discard"
              ? "Discard DLQ entry"
              : "Mark as escalated"
          }
          description={
            confirm.action === "replay"
              ? `Re-process "${confirm.entry.eventType}" — this creates a new workflow run from the original payload.`
              : confirm.action === "discard"
              ? `Permanently discard "${confirm.entry.eventType}". No retry will occur.`
              : `Mark "${confirm.entry.eventType}" as manually escalated/handled. No retry will occur.`
          }
          confirmLabel={
            confirm.action === "replay"
              ? "Replay"
              : confirm.action === "discard"
              ? "Discard"
              : "Escalate"
          }
          variant={confirm.action === "discard" ? "destructive" : "default"}
          onConfirm={() => {
            const { entry, action } = confirm;
            if (action === "replay") return handleReplay(entry.dlqId);
            return handleResolve(entry.dlqId, action === "discard" ? "discarded" : "manual");
          }}
        />
      )}
    </AppShell>
  );
}
