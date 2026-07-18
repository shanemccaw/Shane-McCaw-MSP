import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import type { CmdKEntry } from "./workspaceNav";

// Global quick-jump — the Cmd+K dialog carried over from IDEShell, now fed by
// every workspace's Explorer tree and navigating by route.

interface CmdKDialogProps {
  entries: CmdKEntry[];
  onSelect: (path: string) => void;
  onClose: () => void;
}

export default function CmdKDialog({ entries, onSelect, onClose }: CmdKDialogProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      e => e.label.toLowerCase().includes(q) || e.section.toLowerCase().includes(q)
    );
  }, [entries, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight(h => Math.min(h + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight(h => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const entry = filtered[highlight];
        if (entry) { onSelect(entry.path); onClose(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, highlight, onSelect, onClose]);

  useEffect(() => {
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-popover border border-border rounded-lg shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Jump to…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
          />
          <kbd className="text-[10px] font-mono text-muted-foreground/70 px-1.5 py-0.5 border border-border rounded bg-background">Esc</kbd>
        </div>
        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground/70 text-center py-6">No results</p>
          ) : (
            filtered.map((entry, i) => {
              const Icon = entry.icon;
              return (
                <button
                  key={entry.id}
                  onClick={() => { onSelect(entry.path); onClose(); }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors group ${
                    i === highlight ? "bg-accent" : ""
                  }`}
                >
                  {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{entry.label}</p>
                    <p className="text-[10px] font-mono text-muted-foreground/70 truncate">{entry.section}</p>
                  </div>
                  <ChevronRight className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors" />
                </button>
              );
            })
          )}
        </div>
        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-[10px] font-mono text-muted-foreground/70">
          <span><kbd className="px-1 border border-border rounded bg-background text-[9px]">↑↓</kbd> to navigate</span>
          <span><kbd className="px-1 border border-border rounded bg-background text-[9px]">↵</kbd> to jump</span>
          <span><kbd className="px-1 border border-border rounded bg-background text-[9px]">Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
