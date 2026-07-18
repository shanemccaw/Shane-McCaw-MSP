import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getLogBuffer, subscribeLogs, type LogEntry } from "@/lib/logger";

// Toggleable bottom console — the old IDEShell bottom-panel behavior, global:
// shell/output log plus the "Recent AI Generations" feed that previously
// lived in the Marketing IDE shell's bottom panel.

type ConsoleTab = "output" | "generations";

const LEVEL_TONE: Record<LogEntry["level"], string> = {
  debug: "text-muted-foreground/60",
  info: "text-foreground/80",
  warn: "text-warning",
  error: "text-destructive",
};

function OutputLog() {
  const [entries, setEntries] = useState<LogEntry[]>(() => getLogBuffer());

  useEffect(() => {
    return subscribeLogs(entry => {
      setEntries(prev => [...prev.slice(-499), entry]);
    });
  }, []);

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 font-mono">
        No output yet.
      </div>
    );
  }

  return (
    <div className="font-mono text-[11px] leading-relaxed px-3 py-1.5">
      {entries.map(entry => (
        <div key={entry.seq} className="flex gap-2 whitespace-pre-wrap break-all">
          <span className="text-muted-foreground/50 tabular-nums shrink-0">
            {entry.time.toLocaleTimeString(undefined, { hour12: false })}
          </span>
          <span className="text-primary/80 shrink-0">[{entry.channel}]</span>
          <span className={LEVEL_TONE[entry.level]}>{entry.message}</span>
        </div>
      ))}
    </div>
  );
}

interface GenerationAsset {
  id: number;
  assetType: string;
  title: string;
  createdAt?: string;
}

const ASSET_ICONS: Record<string, string> = {
  cold_email: "✉️",
  linkedin_post: "💼",
  blog_post: "📝",
  newsletter: "📧",
};

function GenerationsFeed() {
  const { fetchWithAuth } = useAuth();
  const [assets, setAssets] = useState<GenerationAsset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchWithAuth("/api/admin/marketing/campaign-assets?limit=20")
      .then(r => r.json())
      .then((d: unknown) => {
        if (!cancelled) setAssets(Array.isArray(d) ? (d as GenerationAsset[]).slice(0, 20) : []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchWithAuth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70">
        No AI generations yet — generate content in Content Hub or Outreach.
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border/60">
      {assets.map(a => (
        <div key={a.id} className="flex items-center gap-3 px-4 py-2">
          <span className="text-sm shrink-0">{ASSET_ICONS[a.assetType] ?? "📄"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-foreground/90 truncate">{a.title}</p>
            <p className="text-[10px] text-muted-foreground/70 truncate">{a.assetType.replace(/_/g, " ")}</p>
          </div>
          {a.createdAt && (
            <span className="text-[10px] font-mono tabular-nums text-muted-foreground/70 shrink-0">
              {new Date(a.createdAt).toLocaleDateString()}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ConsolePanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<ConsoleTab>("output");

  return (
    <div className="h-full flex flex-col bg-card overflow-hidden">
      <div className="flex items-center justify-between pr-2 border-b border-border shrink-0">
        <div className="flex items-stretch">
          {([
            ["output", "Output"],
            ["generations", "AI Generations"],
          ] as Array<[ConsoleTab, string]>).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-widest transition-colors border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
                tab === id
                  ? "text-foreground border-primary"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          title="Close console"
          className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === "output" ? <OutputLog /> : <GenerationsFeed />}
      </div>
    </div>
  );
}
