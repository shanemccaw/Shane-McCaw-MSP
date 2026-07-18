import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, ChevronDown, RefreshCw, CheckCircle, Zap, Download, Upload, X } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunResult {
  id: number;
  customerId: number | null;
  scriptId: number;
  packageId: number | null;
  jobId: string | null;
  rawOutput: Record<string, unknown>;
  parsedFindings: string[];
  recommendations: string[];
  scoreImpact: Record<string, number>;
  status: "running" | "completed" | "failed" | "awaiting_upload";
  executionSource: "automated" | "manual" | "customer_upload";
  uploadedBy: string | null;
  uploadedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  scriptName: string | null;
  clientName: string | null;
  packageName: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_CFG: Record<string, { cls: string; label: string }> = {
  running:         { cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",  label: "Running"         },
  completed:       { cls: "bg-green-500/15 text-green-400 border-green-500/25",     label: "Completed"       },
  failed:          { cls: "bg-red-500/15 text-red-400 border-red-500/25",           label: "Failed"          },
  awaiting_upload: { cls: "bg-amber-500/15 text-amber-400 border-amber-500/25",     label: "Awaiting Upload" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { cls: "bg-border text-muted-foreground border-border", label: status };
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${cfg.cls}`}>
      {(status === "running" || status === "awaiting_upload") && <span className="w-1 h-1 rounded-full bg-current animate-pulse" />}
      {cfg.label}
    </span>
  );
}

// ── Awaiting Upload Panel ─────────────────────────────────────────────────────

function AwaitingUploadPanel({ result, onUploaded }: { result: RunResult; onUploaded: (id: number) => void }) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [jsonText, setJsonText] = useState("");

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/manual-scripts/${result.id}/download`);
      if (!res.ok) { toast({ title: "Failed to download script", variant: "destructive" }); return; }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `script_run_${result.id}.ps1`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch { toast({ title: "Download failed", variant: "destructive" }); }
    finally { setDownloading(false); }
  };

  const handleUpload = async () => {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(jsonText) as Record<string, unknown>; }
    catch { toast({ title: "Invalid JSON — check format and try again", variant: "destructive" }); return; }
    setUploading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/manual-scripts/${result.id}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonData: parsed }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Upload failed", variant: "destructive" }); return;
      }
      toast({ title: "Results uploaded and processed" });
      setShowUploadForm(false); setJsonText(""); onUploaded(result.id);
    } catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setUploading(false); }
  };

  return (
    <div className="px-3 pb-3 pt-2 bg-background border-t border-accent space-y-2">
      <div className="flex items-start gap-2 p-2 bg-amber-500/8 border border-amber-500/20 rounded-lg">
        <span className="text-amber-400 text-sm leading-none mt-0.5">📋</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-amber-300">Awaiting manual execution &amp; upload</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">Download the .ps1, run it in the customer's tenant, then upload the JSON output here.</p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => void handleDownload()}
          disabled={downloading}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-primary border border-primary/30 hover:border-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
        >
          {downloading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          {downloading ? "Downloading…" : "Download .ps1"}
        </button>
        <button
          onClick={() => setShowUploadForm(v => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-amber-400 border border-amber-500/30 hover:border-amber-500 hover:bg-amber-500/10 rounded-lg transition-colors"
        >
          <Upload className="w-3 h-3" />
          Upload JSON
        </button>
      </div>
      {showUploadForm && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Paste JSON output</p>
            <button onClick={() => { setShowUploadForm(false); setJsonText(""); }} className="text-muted-foreground/60 hover:text-muted-foreground">
              <X className="w-3 h-3" />
            </button>
          </div>
          <textarea
            value={jsonText}
            onChange={e => setJsonText(e.target.value)}
            placeholder={'{\n  "data": {...}\n}'}
            rows={6}
            className="w-full border border-border rounded-lg px-2 py-1.5 text-[10px] text-foreground bg-card font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/30 placeholder-muted-foreground/60 resize-y"
          />
          <div className="flex justify-end">
            <button
              onClick={() => void handleUpload()}
              disabled={uploading || !jsonText.trim()}
              className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-lg transition-colors"
            >
              {uploading ? <><RefreshCw className="w-3 h-3 animate-spin" />Processing…</> : <><Upload className="w-3 h-3" />Submit &amp; Analyze</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Expanded row (compact sidebar version) ────────────────────────────────────

function ExpandedRow({ result, onMarkReviewed, onUploaded }: { result: RunResult; onMarkReviewed: (id: number, reviewedAt: string) => void; onUploaded: (id: number) => void }) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [applying, setApplying] = useState(false);
  const [marking, setMarking] = useState(false);
  const [subTab, setSubTab] = useState<"findings" | "json">("findings");

  const hasImpact = Object.values(result.scoreImpact).some(v => v !== 0);

  const handleApplyToClient = async () => {
    if (!result.customerId) return;
    setApplying(true);
    try {
      const res = await fetchWithAuth(`/api/admin/script-run-results/${result.id}/apply-to-client`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to apply scores", variant: "destructive" });
        return;
      }
      const data = await res.json() as { appliedScores: number; appliedProfileFields: number };
      toast({ title: "Scores applied", description: `${data.appliedScores} score categories updated.` });
    } catch {
      toast({ title: "Failed to apply scores", variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const handleMarkReviewed = async () => {
    setMarking(true);
    try {
      const res = await fetchWithAuth(`/api/admin/script-run-results/${result.id}/mark-reviewed`, { method: "PATCH" });
      if (!res.ok) { toast({ title: "Failed to mark as reviewed", variant: "destructive" }); return; }
      const data = await res.json() as { reviewedAt: string };
      toast({ title: "Marked as reviewed" });
      onMarkReviewed(result.id, data.reviewedAt);
    } catch {
      toast({ title: "Failed to mark as reviewed", variant: "destructive" });
    } finally {
      setMarking(false);
    }
  };

  if (result.status === "awaiting_upload") {
    return <AwaitingUploadPanel result={result} onUploaded={onUploaded} />;
  }

  return (
    <div className="px-3 pb-3 pt-2 bg-background border-t border-accent space-y-2">
      <div className="flex gap-1">
        {(["findings", "json"] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
              subTab === t
                ? "bg-primary/15 text-primary border border-primary/30"
                : "text-muted-foreground hover:text-foreground border border-transparent"
            }`}
          >
            {t === "findings" ? "AI Findings" : "JSON"}
          </button>
        ))}
      </div>

      {subTab === "findings" && (
        <div className="space-y-1.5">
          {result.parsedFindings.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/60 italic">No findings</p>
          ) : (
            result.parsedFindings.slice(0, 5).map((f, i) => (
              <p key={i} className="text-[10px] text-foreground/90 leading-relaxed flex gap-1.5">
                <span className="mt-1 w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                {f}
              </p>
            ))
          )}
          {result.parsedFindings.length > 5 && (
            <p className="text-[10px] text-muted-foreground/60">+{result.parsedFindings.length - 5} more</p>
          )}
        </div>
      )}

      {subTab === "json" && (
        <pre className="text-[10px] text-muted-foreground font-mono whitespace-pre-wrap bg-card border border-border rounded p-2 max-h-32 overflow-y-auto">
          {JSON.stringify(result.rawOutput, null, 2) || "(no data)"}
        </pre>
      )}

      <div className="flex items-center gap-2 pt-1">
        {result.customerId && hasImpact && result.status === "completed" && (
          <button
            onClick={() => void handleApplyToClient()}
            disabled={applying}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-primary border border-primary/30 hover:border-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50"
          >
            {applying ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Apply Scores
          </button>
        )}
        {!result.reviewedAt && (
          <button
            onClick={() => void handleMarkReviewed()}
            disabled={marking}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-green-400 border border-green-500/30 hover:border-green-500 hover:bg-green-500/10 rounded transition-colors disabled:opacity-50 ml-auto"
          >
            {marking ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
            Reviewed
          </button>
        )}
      </div>
    </div>
  );
}

// ── Run Results Sidebar Panel ─────────────────────────────────────────────────

interface RunResultsSidebarPanelProps {
  onSelectResult?: (result: RunResult) => void;
  selectedResultId?: number | null;
}

const POLL_INTERVAL = 12;

export default function RunResultsSidebarPanel({ onSelectResult, selectedResultId }: RunResultsSidebarPanelProps = {}) {
  const { fetchWithAuth } = useAuth();
  const [results, setResults] = useState<RunResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [countdown, setCountdown] = useState(POLL_INTERVAL);
  const [pollFlash, setPollFlash] = useState(false);

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/script-run-results?limit=100");
      if (res.ok) setResults(await res.json() as RunResult[]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setCountdown(POLL_INTERVAL);
      if (showRefresh) {
        setPollFlash(false);
        requestAnimationFrame(() => setPollFlash(true));
      }
    }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  const hasRunning = results.some(r => r.status === "running");

  useEffect(() => {
    if (!hasRunning) return;
    const pollId = setInterval(() => { void load(true); }, POLL_INTERVAL * 1000);
    return () => clearInterval(pollId);
  }, [hasRunning, load]);

  useEffect(() => {
    if (!hasRunning) return;
    setCountdown(POLL_INTERVAL);
    const tickId = setInterval(() => {
      setCountdown(c => (c <= 1 ? POLL_INTERVAL : c - 1));
    }, 1000);
    return () => clearInterval(tickId);
  }, [hasRunning]);

  const filtered = statusFilter ? results.filter(r => r.status === statusFilter) : results;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-accent flex-shrink-0">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="flex-1 bg-card border border-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
        >
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="awaiting_upload">Awaiting Upload</option>
        </select>
        {hasRunning && !refreshing && (
          <span
            key={pollFlash ? "flash" : "idle"}
            className={`text-[10px] flex-shrink-0 tabular-nums ${pollFlash ? "poll-flash" : "text-muted-foreground/60"}`}
            onAnimationEnd={() => setPollFlash(false)}
          >
            auto in {countdown}s
          </span>
        )}
        <button
          onClick={() => void load(true)}
          disabled={refreshing}
          title="Refresh"
          className="p-1.5 text-muted-foreground/60 hover:text-foreground hover:bg-accent rounded transition-colors flex-shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <ClipboardList className="w-8 h-8 text-accent mb-2" />
            <p className="text-xs text-muted-foreground/60">{results.length === 0 ? "No run results yet" : "No results match filter"}</p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="divide-y divide-accent">
            {filtered.map(r => {
              const isActive = selectedResultId === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => onSelectResult?.(r)}
                  className={`w-full flex items-start gap-2 px-3 py-2 transition-colors text-left group ${
                    isActive
                      ? "bg-primary/10 border-l-2 border-primary"
                      : "hover:bg-card border-l-2 border-transparent"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-xs truncate font-medium ${isActive ? "text-primary" : "text-foreground"}`}>
                        {r.clientName ?? (r.customerId ? `Client #${r.customerId}` : "No client")}
                      </span>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {r.scriptName ?? `Script #${r.scriptId}`}
                      {r.executionSource === "manual" && <span className="ml-1 text-amber-500/70">📋 Manual</span>}
                    </p>
                    <p className="text-[9px] text-muted-foreground/60 mt-0.5">{formatRelative(r.createdAt)}</p>
                  </div>
                  <div className="flex-shrink-0 mt-0.5">
                    <ChevronDown className={`w-3 h-3 transition-colors ${isActive ? "text-primary" : "text-muted-foreground/60 group-hover:text-muted-foreground"}`} />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <p className="px-3 py-2 text-[9px] text-muted-foreground/60 border-t border-accent">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </div>
  );
}
