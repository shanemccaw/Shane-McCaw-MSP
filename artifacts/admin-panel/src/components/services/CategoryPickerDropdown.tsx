import { useState, useRef, useEffect } from "react";
import { ChevronDown, Folder, FolderOpen, X, Plus } from "lucide-react";

interface CategoryNode {
  name: string;
  path: string;
  depth: number;
  hasChildren: boolean;
}

function buildFlatList(paths: string[]): CategoryNode[] {
  const nodeSet = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      nodeSet.add(cur);
    }
  }

  const sorted = Array.from(nodeSet).sort();
  return sorted.map(path => {
    const depth = path.split("/").length - 1;
    const name = path.split("/").pop()!;
    const hasChildren = sorted.some(p => p.startsWith(path + "/"));
    return { name, path, depth, hasChildren };
  });
}

interface Props {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  allCategoryPaths: string[];
  placeholder?: string;
}

export default function CategoryPickerDropdown({ value, onChange, allCategoryPaths, placeholder = "Select category…" }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const nodes = buildFlatList(allCategoryPaths);

  const filtered = filter
    ? nodes.filter(n => n.path.toLowerCase().includes(filter.toLowerCase()))
    : nodes;

  useEffect(() => {
    if (open) {
      setFilter("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 border rounded-lg px-3 py-2 text-sm bg-background transition-colors text-left ${
          open ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-muted-foreground/60"
        }`}
      >
        {value ? (
          <>
            <Folder className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <span className="flex-1 truncate text-foreground font-mono text-xs">{value}</span>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onChange(null); }}
              className="flex-shrink-0 text-muted-foreground/60 hover:text-foreground p-0.5 rounded"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        ) : (
          <>
            <Folder className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
            <span className="flex-1 text-muted-foreground/60">{placeholder}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
          </>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
          {/* Filter input */}
          <div className="px-3 py-2 border-b border-accent">
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
              placeholder="Filter categories…"
              className="w-full bg-transparent text-xs text-foreground placeholder-muted-foreground/60 outline-none"
            />
          </div>

          {/* Category list */}
          <div className="max-h-52 overflow-y-auto py-1">
            {/* None option */}
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${!value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"}`}
            >
              <span className="italic">— None (uncategorized) —</span>
            </button>

            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground/60 px-3 py-4 text-center">No categories found</p>
            )}

            {filtered.map(node => (
              <button
                key={node.path}
                type="button"
                onClick={() => { onChange(node.path); setOpen(false); }}
                className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                  value === node.path ? "bg-primary/10 text-primary" : "text-foreground/90 hover:bg-accent"
                }`}
                style={{ paddingLeft: `${12 + node.depth * 14}px` }}
              >
                {node.hasChildren
                  ? <FolderOpen className="w-3 h-3 flex-shrink-0 text-muted-foreground/60" />
                  : <Folder className="w-3 h-3 flex-shrink-0 text-muted-foreground/60" />}
                <span className="truncate">{node.name}</span>
                {node.depth > 0 && (
                  <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono truncate opacity-60 max-w-[80px]">{node.path}</span>
                )}
              </button>
            ))}

            {/* Manual entry */}
            {filter && !nodes.find(n => n.path.toLowerCase() === filter.toLowerCase()) && (
              <button
                type="button"
                onClick={() => { onChange(filter.trim()); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-primary hover:bg-primary/10 border-t border-accent mt-1"
              >
                <Plus className="w-3 h-3 flex-shrink-0" />
                <span>Use "<strong>{filter.trim()}</strong>" as new category</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
