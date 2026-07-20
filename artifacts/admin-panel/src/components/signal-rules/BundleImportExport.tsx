import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Download,
  FileText,
  AlertTriangle,
  Loader2,
  ArrowLeftRight,
} from "lucide-react";

// ─── Matches the 3 real backend import endpoints in admin-signal-rules.ts ────
// - "full": POST /admin/signal-rules/import — wipes ALL platform-owned rules
//   and groups and re-inserts from the file. Accepts either the legacy
//   { rules, groups } shape or the real export shape { version, signals: [...] }.
// - "signal": POST /admin/signal-rules/:signalKey/import — replaces all rules
//   for ONE signal only. Accepts a flat rule array or { rules: [...] }.
// - "bundle": POST /admin/signal-rules/import-bundle — additive: creates a
//   brand-new group + rules for one signal from { group, rules }. Does not
//   delete anything.
type ImportMode = "full" | "signal" | "bundle";

const inputCls =
  "w-full border border-border bg-background text-foreground rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60";
const selectCls = inputCls;
const btnPrimaryCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors";
const btnGhostCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-xs font-semibold rounded-lg border border-border hover:border-primary/40 disabled:opacity-40 transition-colors";

interface FullExportPayload {
  version?: number;
  exportedAt?: string;
  signals?: Array<{ key: string; rules?: unknown[]; groups?: unknown[] }>;
}

function summarizeFullPayload(parsed: Record<string, unknown>): { signalCount: number; ruleCount: number; groupCount: number } {
  const signals = Array.isArray((parsed as FullExportPayload).signals) ? (parsed as FullExportPayload).signals! : null;
  if (signals) {
    let ruleCount = 0;
    let groupCount = 0;
    for (const s of signals) {
      ruleCount += Array.isArray(s.rules) ? s.rules.length : 0;
      groupCount += Array.isArray(s.groups) ? s.groups.length : 0;
    }
    return { signalCount: signals.length, ruleCount, groupCount };
  }
  // Legacy { rules, groups } shape.
  const rules = Array.isArray(parsed.rules) ? (parsed.rules as unknown[]) : [];
  const groups = Array.isArray(parsed.groups) ? (parsed.groups as unknown[]) : [];
  const signalKeys = new Set(
    rules.map(r => (r as Record<string, unknown>).signalKey ?? (r as Record<string, unknown>).signal_key).filter(Boolean),
  );
  return { signalCount: signalKeys.size, ruleCount: rules.length, groupCount: groups.length };
}

export default function BundleImportExport() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [exporting, setExporting] = useState(false);

  const [mode, setMode] = useState<ImportMode>("full");
  const [signalKeys, setSignalKeys] = useState<string[]>([]);
  const [targetSignalKey, setTargetSignalKey] = useState("");

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Record<string, unknown> | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Only fetched to populate the per-signal-import dropdown — a lightweight,
  // independent read so this component doesn't need signal-list state threaded
  // in from the Rules tab.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/signal-rules");
        const data = await res.json();
        if (res.ok && data.bySignal) setSignalKeys(Object.keys(data.bySignal).sort());
      } catch {
        // Non-fatal — the per-signal dropdown just stays empty.
      }
    })();
  }, [fetchWithAuth]);

  const resetFile = useCallback(() => {
    setFileName(null);
    setParsed(null);
    setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleModeChange = (next: ImportMode) => {
    setMode(next);
    resetFile();
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules/export");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        toast({ title: body.error ?? "Export failed", variant: "destructive" });
        return;
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `signal-rules-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded" });
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setParsed(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const json = JSON.parse(text) as unknown;
        if (typeof json !== "object" || json === null) {
          setParseError("File does not contain a JSON object.");
          return;
        }
        const body = mode === "signal" && Array.isArray(json) ? { rules: json } : (json as Record<string, unknown>);

        if (mode === "full") {
          if (!Array.isArray(body.signals) && !Array.isArray(body.rules)) {
            setParseError('File must contain a "signals" array (export format) or a "rules" array.');
            return;
          }
        } else if (mode === "signal") {
          if (!Array.isArray(body.rules)) {
            setParseError('File must be a rules array, or an object with a "rules" array.');
            return;
          }
        } else {
          const grp = body.group as Record<string, unknown> | undefined;
          if (!grp || typeof grp.signalKey !== "string" || !Array.isArray(body.rules)) {
            setParseError('File must be { group: { signalKey, logic, label }, rules: [...] }.');
            return;
          }
        }
        setParsed(body);
      } catch {
        setParseError("Invalid JSON — could not parse the file.");
      }
    };
    reader.readAsText(file);
  };

  const preview = (() => {
    if (!parsed) return null;
    if (mode === "full") {
      const { signalCount, ruleCount, groupCount } = summarizeFullPayload(parsed);
      return (
        <div className="space-y-1">
          <div>{signalCount} signal(s), {ruleCount} rule(s), {groupCount} group(s)</div>
          <div className="text-amber-300">
            This REPLACES every platform-owned rule and group across the whole ruleset. A pre-import backup snapshot is
            saved automatically, but MSP-scoped override rules are left untouched.
          </div>
        </div>
      );
    }
    if (mode === "signal") {
      const rules = parsed.rules as unknown[];
      return (
        <div className="space-y-1">
          <div>{rules.length} rule(s) for signal <span className="font-mono">{targetSignalKey || "(select a signal)"}</span></div>
          <div className="text-amber-300">This replaces all existing rules for that signal only. Groups are not recreated.</div>
        </div>
      );
    }
    const grp = parsed.group as Record<string, unknown>;
    const rules = parsed.rules as unknown[];
    return (
      <div className="space-y-1">
        <div>
          New group <span className="font-mono">{String(grp.label ?? "(unlabeled)")}</span> ({String(grp.logic ?? "OR")}) on
          signal <span className="font-mono">{String(grp.signalKey)}</span> with {rules.length} rule(s)
        </div>
        <div className="text-muted-foreground">Additive — creates a new group, does not delete or replace anything.</div>
      </div>
    );
  })();

  const canSubmit = !!parsed && !parseError && (mode !== "signal" || !!targetSignalKey);

  const handleImport = async () => {
    if (!parsed) return;
    setImporting(true);
    try {
      const url =
        mode === "full"
          ? "/api/admin/signal-rules/import"
          : mode === "signal"
          ? `/api/admin/signal-rules/${encodeURIComponent(targetSignalKey)}/import`
          : "/api/admin/signal-rules/import-bundle";

      const res = await fetchWithAuth(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error ?? "Import failed", variant: "destructive" });
        return;
      }

      if (mode === "full") {
        const linkSuffix = data.projectLinksUpdated ? ` ${data.projectLinksUpdated} project link(s) updated.` : "";
        toast({ title: `Imported ${data.imported} rule(s). Previous ruleset saved as snapshot #${data.snapshotId}.${linkSuffix}` });
      } else if (mode === "signal") {
        toast({ title: `Imported ${data.imported} rule(s) for ${data.signalKey}.` });
      } else {
        toast({ title: `Bundle imported — ${data.imported} rule(s) added to group on ${data.signalKey}.` });
      }
      resetFile();
    } catch (err) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-foreground text-base font-semibold flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-primary" />
          Bundle Import / Export
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Export the full platform ruleset as JSON, or import a file into one of three modes. All three import modes
          write real, immediately-active rule data — review the preview before confirming.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
          <Download className="h-3.5 w-3.5" /> Export
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Downloads every platform-owned signal, its rules, its groups, and enabled/disabled state as one JSON file.
          This file round-trips directly through the "Full Replace" import mode below.
        </p>
        <button onClick={() => void handleExport()} disabled={exporting} className={btnPrimaryCls}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Download Export
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
          <Upload className="h-3.5 w-3.5" /> Import
        </h3>

        <div className="flex gap-0 border-b border-border mb-3">
          {([
            { key: "full", label: "Full Replace" },
            { key: "signal", label: "Per-Signal" },
            { key: "bundle", label: "Bundle (New Group)" },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => handleModeChange(t.key)}
              className={`px-4 py-2 text-xs font-semibold transition-colors border-b-2 ${
                mode === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {mode === "signal" && (
          <div className="mb-3">
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Target signal</label>
            <select className={selectCls} value={targetSignalKey} onChange={e => setTargetSignalKey(e.target.value)}>
              <option value="">Select a signal…</option>
              {signalKeys.map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-3">
          <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleFileChange} className={inputCls} />
        </div>

        {fileName && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
            <FileText className="h-3.5 w-3.5" /> {fileName}
          </div>
        )}

        {parseError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 flex items-start gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            {parseError}
          </div>
        )}

        {preview && (
          <div className="rounded-lg border border-border bg-background/40 p-3 text-xs text-foreground/90 mb-3">
            {preview}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button onClick={resetFile} disabled={importing || (!parsed && !parseError)} className={btnGhostCls}>
            Clear
          </button>
          <button onClick={() => void handleImport()} disabled={!canSubmit || importing} className={btnPrimaryCls}>
            {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Confirm Import
          </button>
        </div>
      </div>
    </div>
  );
}
