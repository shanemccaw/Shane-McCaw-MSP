import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import type { ServiceRow } from "@/hooks/useServices";
import VisibilityBadge from "./VisibilityBadge";

interface Props {
  open: boolean;
  onClose: () => void;
  services: ServiceRow[];
  onSelect: (id: number, categoryPath: string | null) => void;
}

function priceLabel(s: ServiceRow): string {
  const fmt = (v: string | null | undefined) => {
    if (!v) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };
  const base = fmt(s.basePrice);
  const max = fmt(s.maxPrice);
  if (base && max) return `${base}–${max}`;
  if (base) return base;
  return fmt(s.price) ?? "";
}

export default function CatalogQuickJump({ open, onClose, services, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = services.filter(s => {
    if (!query) return true;
    const q = query.toLowerCase();
    const inName = s.name.toLowerCase().includes(q);
    const inCategory = (s.categoryPath ?? s.category ?? "").toLowerCase().includes(q);
    const inTags = (s.tags ?? []).some(t => t.toLowerCase().includes(q));
    return inName || inCategory || inTags;
  });

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setHighlightedIdx(0);
  }, [query]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const svc = filtered[highlightedIdx];
      if (svc) onSelect(svc.id, svc.categoryPath ?? null);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${highlightedIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIdx]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#30363D]">
          <Search className="w-4 h-4 text-[#7D8590] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Jump to a service — search by name, category, or tag…"
            className="flex-1 bg-transparent text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none"
          />
          <button type="button" onClick={onClose} className="text-[#484F58] hover:text-[#7D8590]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#484F58]">No services match "{query}"</div>
          ) : (
            filtered.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                data-idx={idx}
                onClick={() => onSelect(s.id, s.categoryPath ?? null)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${idx === highlightedIdx ? "bg-[#0078D4]/10" : "hover:bg-[#1C2128]"}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[#E6EDF3] truncate">{s.name}</p>
                    {s.serviceType && (
                      <span className="flex-shrink-0 text-[10px] font-semibold bg-[#0078D4]/10 text-[#0078D4] px-1.5 py-0.5 rounded uppercase tracking-wider">
                        {s.serviceType.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  {(s.categoryPath ?? s.category) && (
                    <p className="text-xs text-[#7D8590] mt-0.5 truncate">{s.categoryPath ?? s.category}</p>
                  )}
                  {(s.tags ?? []).length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {(s.tags ?? []).slice(0, 4).map(t => (
                        <span key={t} className="text-[10px] bg-[#1C2128] border border-[#30363D] text-[#7D8590] px-1.5 py-0.5 rounded">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {priceLabel(s) && <span className="text-xs font-semibold text-[#0078D4]">{priceLabel(s)}</span>}
                  <VisibilityBadge visibility={s.visibility} size="xs" />
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-[#21262D] bg-[#0D1117]">
          <span className="text-[11px] text-[#484F58]"><kbd className="bg-[#21262D] border border-[#30363D] rounded px-1 py-0.5 font-mono text-[10px]">↑↓</kbd> navigate</span>
          <span className="text-[11px] text-[#484F58]"><kbd className="bg-[#21262D] border border-[#30363D] rounded px-1 py-0.5 font-mono text-[10px]">↵</kbd> select</span>
          <span className="text-[11px] text-[#484F58]"><kbd className="bg-[#21262D] border border-[#30363D] rounded px-1 py-0.5 font-mono text-[10px]">Esc</kbd> close</span>
          <span className="ml-auto text-[11px] text-[#484F58]">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );
}
