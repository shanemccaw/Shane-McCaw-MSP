import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, CheckCircle, Zap, Download, Upload, X, ArrowLeft } from "lucide-react";
import type { RunResult } from "@/components/RunResultsSidebarPanel";

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
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      {(status === "running" || status === "awaiting_upload") && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {cfg.label}
    </span>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = "findings" | "score-impact" | "m365-score" | "raw-output";

const TABS: { id: Tab; label: string }[] = [
  { id: "findings",     label: "AI Findings"  },
  { id: "score-impact", label: "Score Impact" },
  { id: "m365-score",   label: "M365 Score"   },
  { id: "raw-output",   label: "Raw Output"   },
];

// ── AI Findings Tab ───────────────────────────────────────────────────────────

function FindingsTab({ result, isAnalyzing }: { result: RunResult; isAnalyzing?: boolean }) {
  const hasFindings = result.parsedFindings.length > 0;
  const hasRecs = result.recommendations.length > 0;

  if (isAnalyzing && !hasFindings && !hasRecs) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-primary/10 border border-primary/25">
          <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
          <p className="text-xs font-medium text-primary">AI analyzing results…</p>
        </div>
        <div className="space-y-2 animate-pulse">
          {[80, 65, 90, 55].map((w, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-accent mt-0.5" />
              <div className="flex-1 h-4 rounded bg-accent" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground/60 text-center pt-2">Checking again shortly…</p>
      </div>
    );
  }

  if (!hasFindings && !hasRecs) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <svg className="w-10 h-10 text-accent mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <p className="text-sm text-muted-foreground/60">No AI findings or recommendations</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {hasFindings && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Findings ({result.parsedFindings.length})
          </h3>
          <ol className="space-y-2">
            {result.parsedFindings.map((f, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/15 border border-primary/30 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-foreground/90 leading-relaxed">{f}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {hasRecs && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Recommendations ({result.recommendations.length})
          </h3>
          <ul className="space-y-2">
            {result.recommendations.map((r, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-400 mt-2" />
                <p className="text-sm text-foreground/90 leading-relaxed">{r}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Score Impact Tab ──────────────────────────────────────────────────────────

function ScoreImpactTab({ result }: { result: RunResult }) {
  const entries = Object.entries(result.scoreImpact);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <svg className="w-10 h-10 text-accent mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p className="text-sm text-muted-foreground/60">No score impact data</p>
      </div>
    );
  }

  const maxAbs = Math.max(...entries.map(([, v]) => Math.abs(v)), 1);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground/60">{entries.length} score categories affected</p>
      {entries.map(([key, value]) => {
        const isPos = value > 0;
        const isNeg = value < 0;
        const barPct = Math.round((Math.abs(value) / maxAbs) * 100);
        const barColor = isPos ? "bg-green-500" : isNeg ? "bg-red-500" : "bg-border";
        const textColor = isPos ? "text-green-400" : isNeg ? "text-red-400" : "text-muted-foreground";
        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground/90 font-medium capitalize">{key.replace(/_/g, " ")}</span>
              <span className={`text-sm font-bold tabular-nums ${textColor}`}>
                {isPos ? "+" : ""}{value}
              </span>
            </div>
            <div className="h-1.5 bg-accent rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${barPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── M365 Score Before/After Tab ───────────────────────────────────────────────

interface ClientScores {
  identity: number;
  security: number;
  collaboration: number;
  compliance: number;
  copilotReadiness: number;
}

const SCORE_KEYS: Array<{ key: keyof ClientScores; label: string }> = [
  { key: "identity",         label: "Identity"          },
  { key: "security",         label: "Security"          },
  { key: "collaboration",    label: "Collaboration"     },
  { key: "compliance",       label: "Compliance"        },
  { key: "copilotReadiness", label: "Copilot Readiness" },
];

function M365ScoreTab({ result }: { result: RunResult }) {
  const { fetchWithAuth } = useAuth();
  const [scores, setScores] = useState<ClientScores | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deltas = result.scoreImpact as Record<string, number>;
  const hasDeltas = Object.keys(deltas).length > 0 && Object.values(deltas).some(v => v !== 0);

  useEffect(() => {
    if (!result.customerId) return;
    setLoading(true);
    setError(null);
    fetchWithAuth(`/api/admin/clients/${result.customerId}/scores`)
      .then(async r => {
        if (!r.ok) { setError("Could not load client scores"); return; }
        const data = await r.json() as ClientScores;
        setScores(data);
      })
      .catch(() => setError("Network error loading scores"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.customerId]);

  if (!result.customerId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <svg className="w-10 h-10 text-accent mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        <p className="text-sm text-muted-foreground/60">No client linked to this run</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {SCORE_KEYS.map(({ key }) => (
          <div key={key} className="h-14 bg-card rounded-lg border border-accent" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  const base: ClientScores = scores ?? { identity: 0, security: 0, collaboration: 0, compliance: 0, copilotReadiness: 0 };

  if (!hasDeltas) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 px-1 mb-1">
          <span>Category</span>
          <span className="text-center">Current Score</span>
        </div>
        {SCORE_KEYS.map(({ key, label }) => {
          const current = base[key];
          return (
            <div key={key} className="grid grid-cols-2 items-center bg-card border border-accent rounded-lg px-3 py-3 gap-2">
              <span className="text-xs text-foreground/90 font-medium">{label}</span>
              <div className="flex flex-col items-center">
                <span className="text-sm font-bold text-foreground tabular-nums">{current}</span>
                <div className="w-full h-1 bg-accent rounded-full mt-1">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${current}%` }} />
                </div>
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground/60 text-center pt-1">No projected changes from this run</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 px-1 mb-1">
        <span>Category</span>
        <span className="text-center">Current</span>
        <span className="text-center">After Script</span>
      </div>
      {SCORE_KEYS.filter(({ key }) => deltas[key] !== undefined && deltas[key] !== 0).map(({ key, label }) => {
        const current = base[key];
        const delta = deltas[key] ?? 0;
        const after = Math.max(0, Math.min(100, current + delta));
        const isPos = delta > 0;
        const arrowColor = isPos ? "text-green-400" : "text-red-400";
        const deltaText = isPos ? `+${delta}` : String(delta);
        return (
          <div key={key} className="grid grid-cols-3 items-center bg-card border border-accent rounded-lg px-3 py-3 gap-2">
            <span className="text-xs text-foreground/90 font-medium">{label}</span>
            <div className="flex flex-col items-center">
              <span className="text-sm font-bold text-foreground tabular-nums">{current}</span>
              <div className="w-full h-1 bg-accent rounded-full mt-1">
                <div className="h-full bg-primary rounded-full" style={{ width: `${current}%` }} />
              </div>
            </div>
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-1">
                <span className={`text-[10px] font-bold ${arrowColor}`}>{isPos ? "▲" : "▼"}</span>
                <span className="text-sm font-bold text-foreground tabular-nums">{after}</span>
                <span className={`text-[10px] font-semibold ${arrowColor}`}>({deltaText})</span>
              </div>
              <div className="w-full h-1 bg-accent rounded-full mt-1">
                <div
                  className={`h-full rounded-full ${isPos ? "bg-green-500" : "bg-red-500"}`}
                  style={{ width: `${after}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Raw Output Tab ────────────────────────────────────────────────────────────

/** Escape HTML entities to prevent XSS in dangerouslySetInnerHTML output */
function escHtml(s: string): string {
  return s.replace(/&/g, "&#38;").replace(/</g, "&#60;").replace(/>/g, "&#62;");
}

/**
 * Colorize a JSON string with inline style spans.
 * Works on the HTML-escaped version so injection is not possible.
 */
function colorizeJson(raw: string): string {
  const escaped = escHtml(raw);
  // Regex groups: 1=key, 2=string value, 3=bool/null, 4=number
  return escaped.replace(
    /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/gm,
    (match, keyStr, valStr, boolNull, num) => {
      if (keyStr !== undefined)
        return `<span style="color:#79C0FF">${match}</span>`;
      if (valStr !== undefined)
        return `<span style="color:#A5D6FF">${match}</span>`;
      if (boolNull === "true" || boolNull === "false")
        return `<span style="color:#56D364">${match}</span>`;
      if (boolNull === "null")
        return `<span style="color:#8B94A3">${match}</span>`;
      if (num !== undefined)
        return `<span style="color:#FFA657">${match}</span>`;
      return match;
    },
  );
}

function RawOutputTab({ result }: { result: RunResult }) {
  const [copied, setCopied] = useState(false);

  const { plainText, highlighted, lineCount, byteCount } = useMemo(() => {
    // If rawOutput is a string that looks like JSON, try to parse + re-format it
    let value: unknown = result.rawOutput;
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { /* keep as string */ }
    }
    let plain = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
    // Unescape JSON-encoded newlines: when JSON.stringify re-serialises an object whose
    // string values contain actual newlines, those newlines become literal \r\n / \n / \r
    // escape sequences (4- or 2-char) in the output text. Replace them with real newlines
    // so the <pre> block can break on them.
    plain = plain.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");
    // Normalise any remaining actual Windows/old-Mac line endings
    plain = plain.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = plain ? plain.split("\n").length : 0;
    const bytes = new TextEncoder().encode(plain).length;
    return {
      plainText: plain,
      highlighted: plain ? colorizeJson(plain) : "",
      lineCount: lines,
      byteCount: bytes,
    };
  }, [result.rawOutput]);

  const handleCopy = () => {
    navigator.clipboard.writeText(plainText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lineNums = lineCount > 0 ? Array.from({ length: lineCount }, (_, i) => i + 1) : [];

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground/60">Raw JSON output</p>
          {lineCount > 0 && (
            <span className="text-[10px] text-muted-foreground/60 bg-card border border-accent rounded px-1.5 py-0.5">
              {lineCount} lines · {byteCount < 1024 ? `${byteCount} B` : `${(byteCount / 1024).toFixed(1)} KB`}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          disabled={!plainText}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
        >
          {copied
            ? <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          }
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Code block */}
      {!plainText ? (
        <div className="flex-1 flex items-center justify-center bg-background border border-border rounded-lg">
          <p className="text-xs text-muted-foreground/60">(no output data)</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 bg-background border border-border rounded-lg overflow-auto">
          <div className="flex min-w-0">
            {/* Line numbers */}
            <div
              className="flex-shrink-0 select-none text-right pr-3 pl-3 py-4 border-r border-accent text-muted-foreground/60"
              style={{ fontFamily: "'Cascadia Code','Fira Code','Consolas',monospace", fontSize: "11px", lineHeight: "1.6" }}
              aria-hidden
            >
              {lineNums.map((n) => (
                <div key={n}>{n}</div>
              ))}
            </div>
            {/* Highlighted content */}
            <pre
              className="flex-1 py-4 pl-4 pr-6 text-foreground/90 overflow-visible"
              style={{
                fontFamily: "'Cascadia Code','Fira Code','Consolas',monospace",
                fontSize: "11px",
                lineHeight: "1.6",
                margin: 0,
                whiteSpace: "pre",
              }}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Awaiting Upload Actions ───────────────────────────────────────────────────

function AwaitingUploadActions({ result, onUploaded }: { result: RunResult; onUploaded: (id: number) => void }) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showForm, setShowForm] = useState(false);
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
      setShowForm(false); setJsonText(""); onUploaded(result.id);
    } catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setUploading(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 p-3 bg-amber-500/8 border border-amber-500/20 rounded-lg">
        <span className="text-amber-400 text-base leading-none mt-0.5">📋</span>
        <div>
          <p className="text-sm font-semibold text-amber-300">Awaiting manual execution &amp; upload</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">Download the .ps1, run it in the customer's tenant, then upload the JSON output here.</p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => void handleDownload()}
          disabled={downloading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-primary border border-primary/30 hover:border-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
        >
          {downloading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {downloading ? "Downloading…" : "Download .ps1"}
        </button>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-amber-400 border border-amber-500/30 hover:border-amber-500 hover:bg-amber-500/10 rounded-lg transition-colors"
        >
          <Upload className="w-4 h-4" />
          Upload JSON
        </button>
      </div>
      {showForm && (
        <div className="space-y-2 border border-border rounded-lg p-3 bg-background">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Paste JSON output</p>
            <button onClick={() => { setShowForm(false); setJsonText(""); }} className="text-muted-foreground/60 hover:text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <textarea
            value={jsonText}
            onChange={e => setJsonText(e.target.value)}
            placeholder={'{\n  "data": {...}\n}'}
            rows={8}
            className="w-full border border-border rounded-lg px-3 py-2 text-xs text-foreground bg-card font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/30 placeholder-muted-foreground/60 resize-y"
          />
          <div className="flex justify-end">
            <button
              onClick={() => void handleUpload()}
              disabled={uploading || !jsonText.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-lg transition-colors"
            >
              {uploading ? <><RefreshCw className="w-4 h-4 animate-spin" />Processing…</> : <><Upload className="w-4 h-4" />Submit &amp; Analyze</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface RunResultDetailPanelProps {
  result: RunResult;
  onClose: () => void;
  onMarkReviewed: (id: number, reviewedAt: string) => void;
  onUploaded: (id: number) => void;
}

export default function RunResultDetailPanel({ result, onClose, onMarkReviewed, onUploaded }: RunResultDetailPanelProps) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>("findings");
  const [applying, setApplying] = useState(false);
  const [marking, setMarking] = useState(false);

  // ── AI analysis polling ────────────────────────────────────────────────────
  const [liveResult, setLiveResult] = useState<RunResult>(result);
  const analysisPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAnalyzing =
    liveResult.status === "completed" &&
    liveResult.executionSource === "customer_upload" &&
    liveResult.parsedFindings.length === 0 &&
    liveResult.recommendations.length === 0;

  const pollAnalysis = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/admin/script-runs/${liveResult.id}`);
      if (!res.ok) return;
      const data = await res.json() as {
        parsedFindings: string[] | null;
        recommendations: string[] | null;
        scoreImpact: Record<string, number> | null;
      };
      const findings = data.parsedFindings ?? [];
      const recs = data.recommendations ?? [];
      if (findings.length > 0 || recs.length > 0) {
        if (analysisPollRef.current) {
          clearInterval(analysisPollRef.current);
          analysisPollRef.current = null;
        }
        setLiveResult(prev => ({
          ...prev,
          parsedFindings: findings,
          recommendations: recs,
          scoreImpact: data.scoreImpact ?? prev.scoreImpact,
        }));
      }
    } catch {
      // ignore transient failures
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchWithAuth, liveResult.id]);

  useEffect(() => {
    if (!isAnalyzing) return;
    analysisPollRef.current = setInterval(() => void pollAnalysis(), 4000);
    return () => {
      if (analysisPollRef.current) {
        clearInterval(analysisPollRef.current);
        analysisPollRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnalyzing]);

  // Sync liveResult if the parent passes a new result (e.g. after upload)
  useEffect(() => {
    setLiveResult(result);
  }, [result]);

  const hasImpact = Object.keys(liveResult.scoreImpact).length > 0 && Object.values(liveResult.scoreImpact).some(v => v !== 0);

  const handleApplyToClient = async () => {
    if (!liveResult.customerId) return;
    setApplying(true);
    try {
      const res = await fetchWithAuth(`/api/admin/script-run-results/${liveResult.id}/apply-to-client`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to apply scores", variant: "destructive" }); return;
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
      const res = await fetchWithAuth(`/api/admin/script-run-results/${liveResult.id}/mark-reviewed`, { method: "PATCH" });
      if (!res.ok) { toast({ title: "Failed to mark as reviewed", variant: "destructive" }); return; }
      const data = await res.json() as { reviewedAt: string };
      toast({ title: "Marked as reviewed" });
      onMarkReviewed(liveResult.id, data.reviewedAt);
    } catch {
      toast({ title: "Failed to mark as reviewed", variant: "destructive" });
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">

      {/* Header */}
      <div className="flex items-start gap-3 px-5 py-3 border-b border-accent bg-card flex-shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0 mt-0.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Editor
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">
              {liveResult.scriptName ?? `Script #${liveResult.scriptId}`}
            </span>
            <StatusBadge status={liveResult.status} />
            {liveResult.executionSource === "manual" && (
              <span className="text-[10px] text-amber-500/80 font-medium">📋 Manual</span>
            )}
            {isAnalyzing && (
              <span className="flex items-center gap-1 text-[10px] text-primary font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                AI analyzing…
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {liveResult.clientName && (
              <span className="text-xs text-muted-foreground">
                {liveResult.clientName}
              </span>
            )}
            {liveResult.packageName && (
              <>
                <span className="text-border">·</span>
                <span className="text-xs text-muted-foreground">{liveResult.packageName}</span>
              </>
            )}
            <span className="text-border">·</span>
            <span className="text-xs text-muted-foreground/60">{formatRelative(liveResult.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-5 py-2 border-b border-accent bg-background flex-shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === tab.id
                ? "bg-primary/15 text-primary border border-primary/30"
                : "text-muted-foreground hover:text-foreground border border-transparent"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className={`flex-1 min-h-0 overflow-y-auto px-5 py-4 ${activeTab === "raw-output" ? "flex flex-col" : ""}`}>
        {activeTab === "findings" && <FindingsTab result={liveResult} isAnalyzing={isAnalyzing} />}
        {activeTab === "score-impact" && <ScoreImpactTab result={liveResult} />}
        {activeTab === "m365-score" && <M365ScoreTab result={liveResult} />}
        {activeTab === "raw-output" && <RawOutputTab result={liveResult} />}
      </div>

      {/* Action bar */}
      {liveResult.status !== "awaiting_upload" && (liveResult.customerId && hasImpact && liveResult.status === "completed" || !liveResult.reviewedAt) && (
        <div className="flex items-center gap-2 px-5 py-3 border-t border-accent bg-card flex-shrink-0">
          {liveResult.customerId && hasImpact && liveResult.status === "completed" && (
            <button
              onClick={() => void handleApplyToClient()}
              disabled={applying}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-primary border border-primary/30 hover:border-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
            >
              {applying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Apply Scores
            </button>
          )}
          {!liveResult.reviewedAt && (
            <div className="ml-auto flex flex-col items-end gap-0.5">
              <button
                onClick={() => void handleMarkReviewed()}
                disabled={marking}
                title="Flags this result as acknowledged — no further action needed."
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-green-400 border border-green-500/30 hover:border-green-500 hover:bg-green-500/10 rounded-lg transition-colors disabled:opacity-50"
              >
                {marking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Mark Reviewed
              </button>
              <p className="text-[10px] text-muted-foreground/60 pr-0.5">Flags this result as acknowledged — no further action needed.</p>
            </div>
          )}
        </div>
      )}

      {/* Awaiting upload action area */}
      {liveResult.status === "awaiting_upload" && (
        <div className="border-t border-accent px-5 py-4 flex-shrink-0">
          <AwaitingUploadActions result={liveResult} onUploaded={onUploaded} />
        </div>
      )}
    </div>
  );
}
