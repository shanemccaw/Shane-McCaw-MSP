import { useState, useCallback, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
interface JsonObject { [key: string]: JsonValue }
type JsonArray = JsonValue[];

type DiffStatus = "added" | "removed" | "changed" | "unchanged";

interface DiffNode {
  status: DiffStatus;
  leftValue?: JsonValue;
  rightValue?: JsonValue;
  children?: Record<string, DiffNode>;
  arrayChildren?: DiffNode[];
  isArray?: boolean;
}

interface DiffSummary { added: number; removed: number; changed: number }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJson(text: string): { value: JsonValue; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, error: null };
  try {
    return { value: JSON.parse(trimmed) as JsonValue, error: null };
  } catch (e) {
    return { value: null, error: (e as Error).message };
  }
}

function prettyPrint(value: JsonValue): string {
  return JSON.stringify(value, null, 2);
}

function minify(value: JsonValue): string {
  return JSON.stringify(value);
}

function getType(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function getPathString(path: (string | number)[]): string {
  return path.reduce<string>((acc, seg, i) => {
    if (typeof seg === "number") return `${acc}[${seg}]`;
    if (i === 0) return String(seg);
    return `${acc}.${seg}`;
  }, "");
}

function highlightMatch(text: string, search: string) {
  if (!search) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="bg-yellow-400/30 text-yellow-300 rounded-sm px-0.5">{text.slice(idx, idx + search.length)}</mark>
      {text.slice(idx + search.length)}
    </span>
  );
}

function nodeMatchesSearch(value: JsonValue, search: string): boolean {
  if (!search) return false;
  const lower = search.toLowerCase();
  if (value === null) return "null".includes(lower);
  if (typeof value === "boolean") return String(value).includes(lower);
  if (typeof value === "number") return String(value).includes(lower);
  if (typeof value === "string") return value.toLowerCase().includes(lower);
  return false;
}

function treeHasMatch(value: JsonValue, search: string): boolean {
  if (!search) return false;
  if (nodeMatchesSearch(value, search)) return true;
  if (Array.isArray(value)) return value.some(v => treeHasMatch(v, search));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(([k, v]) => {
      const lower = search.toLowerCase();
      if (k.toLowerCase().includes(lower)) return true;
      return treeHasMatch(v, search);
    });
  }
  return false;
}

// ─── Diff algorithm ───────────────────────────────────────────────────────────

function diffValues(left: JsonValue, right: JsonValue): DiffNode {
  if (left === right) return { status: "unchanged", leftValue: left, rightValue: right };

  const leftType = getType(left);
  const rightType = getType(right);

  if (leftType === "object" && rightType === "object" && !Array.isArray(left) && !Array.isArray(right)) {
    const leftObj = left as JsonObject;
    const rightObj = right as JsonObject;
    const allKeys = new Set([...Object.keys(leftObj), ...Object.keys(rightObj)]);
    const children: Record<string, DiffNode> = {};
    let hasChange = false;

    for (const key of allKeys) {
      if (!(key in leftObj)) {
        children[key] = { status: "added", rightValue: rightObj[key] };
        hasChange = true;
      } else if (!(key in rightObj)) {
        children[key] = { status: "removed", leftValue: leftObj[key] };
        hasChange = true;
      } else {
        const child = diffValues(leftObj[key], rightObj[key]);
        children[key] = child;
        if (child.status !== "unchanged") hasChange = true;
      }
    }

    return { status: hasChange ? "changed" : "unchanged", children, leftValue: left, rightValue: right };
  }

  if (leftType === "array" && rightType === "array") {
    const leftArr = left as JsonArray;
    const rightArr = right as JsonArray;
    const maxLen = Math.max(leftArr.length, rightArr.length);
    const arrayChildren: DiffNode[] = [];
    let hasChange = false;

    for (let i = 0; i < maxLen; i++) {
      if (i >= leftArr.length) {
        arrayChildren.push({ status: "added", rightValue: rightArr[i] });
        hasChange = true;
      } else if (i >= rightArr.length) {
        arrayChildren.push({ status: "removed", leftValue: leftArr[i] });
        hasChange = true;
      } else {
        const child = diffValues(leftArr[i], rightArr[i]);
        arrayChildren.push(child);
        if (child.status !== "unchanged") hasChange = true;
      }
    }

    return { status: hasChange ? "changed" : "unchanged", arrayChildren, isArray: true, leftValue: left, rightValue: right };
  }

  return { status: "changed", leftValue: left, rightValue: right };
}

function computeSummary(node: DiffNode, summary: DiffSummary = { added: 0, removed: 0, changed: 0 }): DiffSummary {
  if (node.children) {
    for (const child of Object.values(node.children)) {
      if (child.status === "added") summary.added++;
      else if (child.status === "removed") summary.removed++;
      else if (child.status === "changed") {
        if (!child.children && !child.arrayChildren) summary.changed++;
      }
      computeSummary(child, summary);
    }
  }
  if (node.arrayChildren) {
    for (const child of node.arrayChildren) {
      if (child.status === "added") summary.added++;
      else if (child.status === "removed") summary.removed++;
      else if (child.status === "changed") {
        if (!child.children && !child.arrayChildren) summary.changed++;
      }
      computeSummary(child, summary);
    }
  }
  return summary;
}

// ─── JsonNode (recursive viewer) ─────────────────────────────────────────────

interface JsonNodeProps {
  keyName?: string | number;
  value: JsonValue;
  path: (string | number)[];
  depth: number;
  search: string;
  expandAll: boolean | null;
  onCopy: (text: string, label: string) => void;
}

function ValueChip({ value, search, onCopy, path }: { value: JsonValue; search: string; onCopy: (text: string, label: string) => void; path: (string | number)[] }) {
  const type = getType(value);
  const isMatch = nodeMatchesSearch(value, search);

  let colorClass = "";
  let displayText = "";

  if (type === "string") {
    colorClass = "text-emerald-400";
    displayText = `"${value as string}"`;
  } else if (type === "number") {
    colorClass = "text-blue-400";
    displayText = String(value);
  } else if (type === "boolean") {
    colorClass = "text-orange-400";
    displayText = String(value);
  } else if (type === "null") {
    colorClass = "text-muted-foreground";
    displayText = "null";
  }

  return (
    <button
      onClick={() => onCopy(String(value), "Value")}
      className={`font-mono text-xs ${colorClass} hover:underline cursor-pointer ${isMatch ? "bg-yellow-400/20 rounded px-0.5" : ""}`}
      title="Click to copy value"
    >
      {search && type === "string"
        ? highlightMatch(displayText, search)
        : displayText
      }
    </button>
  );
}

function JsonNode({ keyName, value, path, depth, search, expandAll, onCopy }: JsonNodeProps) {
  const type = getType(value);
  const isExpandable = type === "object" || type === "array";
  const childCount = isExpandable
    ? Array.isArray(value)
      ? (value as JsonArray).length
      : Object.keys(value as JsonObject).length
    : 0;

  const keyMatchesSearch = keyName !== undefined && search
    ? String(keyName).toLowerCase().includes(search.toLowerCase())
    : false;

  const childrenHaveMatch = isExpandable && search ? treeHasMatch(value, search) : false;
  const shouldForceExpand = (search && (keyMatchesSearch || childrenHaveMatch)) ?? false;

  const [expanded, setExpanded] = useState(depth < 2);

  useEffect(() => {
    if (expandAll === true) setExpanded(true);
    else if (expandAll === false) setExpanded(false);
  }, [expandAll]);

  useEffect(() => {
    if (shouldForceExpand) setExpanded(true);
  }, [shouldForceExpand]);

  const indent = depth * 16;
  const pathStr = getPathString(path);

  const keyEl = keyName !== undefined && (
    <button
      onClick={() => onCopy(pathStr, "Path")}
      title={`Click to copy path: ${pathStr}`}
      className={`font-mono text-xs font-semibold hover:underline cursor-pointer ${keyMatchesSearch ? "bg-yellow-400/20 rounded px-0.5" : ""}`}
      style={{ color: "#79C0FF" }}
    >
      {search ? highlightMatch(String(keyName), search) : String(keyName)}
    </button>
  );

  if (!isExpandable) {
    return (
      <div className="flex items-center gap-1 py-0.5 hover:bg-accent rounded group" style={{ paddingLeft: indent + 4 }}>
        {keyEl}
        {keyName !== undefined && <span className="text-muted-foreground font-mono text-xs">:</span>}
        <ValueChip value={value} search={search} onCopy={onCopy} path={path} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";
  const entries = isArray
    ? (value as JsonArray).map((v, i) => ({ k: i, v }))
    : Object.entries(value as JsonObject).map(([k, v]) => ({ k, v }));

  return (
    <div>
      <div
        className="flex items-center gap-1 py-0.5 hover:bg-accent rounded cursor-pointer select-none"
        style={{ paddingLeft: indent + 4 }}
        onClick={() => setExpanded(e => !e)}
      >
        <svg
          className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {keyEl}
        {keyName !== undefined && <span className="text-muted-foreground font-mono text-xs">:</span>}
        <span className="font-mono text-xs text-foreground">{openBracket}</span>
        {!expanded && (
          <span className="font-mono text-xs text-muted-foreground">
            {isArray ? `${childCount} item${childCount !== 1 ? "s" : ""}` : `${childCount} key${childCount !== 1 ? "s" : ""}`}
          </span>
        )}
        {!expanded && <span className="font-mono text-xs text-foreground">{closeBracket}</span>}
      </div>

      {expanded && (
        <>
          {entries.map(({ k, v }) => (
            <JsonNode
              key={k}
              keyName={k}
              value={v}
              path={[...path, k]}
              depth={depth + 1}
              search={search}
              expandAll={expandAll}
              onCopy={onCopy}
            />
          ))}
          <div style={{ paddingLeft: indent + 4 }}>
            <span className="font-mono text-xs text-foreground">{closeBracket}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── DiffNodeView (recursive diff renderer) ───────────────────────────────────

interface DiffNodeViewProps {
  keyName?: string | number;
  node: DiffNode;
  depth: number;
}

const STATUS_STYLES: Record<DiffStatus, { bg: string; text: string; badge: string }> = {
  added:     { bg: "bg-emerald-500/10", text: "text-emerald-400", badge: "bg-emerald-500/20 text-emerald-300" },
  removed:   { bg: "bg-red-500/10",     text: "text-red-400",     badge: "bg-red-500/20 text-red-300" },
  changed:   { bg: "bg-amber-500/10",   text: "text-amber-400",   badge: "bg-amber-500/20 text-amber-300" },
  unchanged: { bg: "",                  text: "text-muted-foreground",   badge: "" },
};

function renderSimpleValue(value: JsonValue | undefined, statusText: string): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

function DiffNodeView({ keyName, node, depth }: DiffNodeViewProps) {
  const indent = depth * 16;
  const styles = STATUS_STYLES[node.status];
  const [expanded, setExpanded] = useState(true);
  const hasChildren = !!(node.children || node.arrayChildren);

  const statusBadge = node.status !== "unchanged" && (
    <span className={`text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded ${styles.badge}`}>
      {node.status}
    </span>
  );

  const keyEl = keyName !== undefined && (
    <span className={`font-mono text-xs font-semibold ${node.status === "unchanged" ? "text-[#79C0FF]" : styles.text}`}>
      {String(keyName)}
    </span>
  );

  if (!hasChildren) {
    if (node.status === "changed") {
      return (
        <div className={`rounded mb-0.5 px-2 py-1 ${styles.bg}`} style={{ marginLeft: indent }}>
          <div className="flex items-center gap-1 flex-wrap">
            {keyEl}
            {keyName !== undefined && <span className="text-muted-foreground/60 font-mono text-xs">:</span>}
            <span className="font-mono text-xs text-red-400 line-through">{renderSimpleValue(node.leftValue, "")}</span>
            <svg className="w-3 h-3 text-muted-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            <span className="font-mono text-xs text-emerald-400">{renderSimpleValue(node.rightValue, "")}</span>
            {statusBadge}
          </div>
        </div>
      );
    }

    const displayValue = node.status === "added" ? node.rightValue : node.leftValue;
    return (
      <div className={`rounded mb-0.5 px-2 py-0.5 flex items-center gap-1 ${node.status !== "unchanged" ? styles.bg : ""}`} style={{ marginLeft: indent }}>
        {node.status === "added" && <span className="font-mono text-xs text-emerald-400 select-none">+</span>}
        {node.status === "removed" && <span className="font-mono text-xs text-red-400 select-none">−</span>}
        {node.status === "unchanged" && <span className="w-3" />}
        {keyEl}
        {keyName !== undefined && <span className="text-muted-foreground/60 font-mono text-xs">:</span>}
        <span className={`font-mono text-xs ${styles.text}`}>{renderSimpleValue(displayValue, "")}</span>
        {statusBadge}
      </div>
    );
  }

  const isArr = node.isArray || !!node.arrayChildren;
  const openBracket = isArr ? "[" : "{";
  const closeBracket = isArr ? "]" : "}";
  const entries = node.children
    ? Object.entries(node.children)
    : (node.arrayChildren ?? []).map((n, i) => [i, n] as [string | number, DiffNode]);

  return (
    <div style={{ marginLeft: indent }}>
      <div
        className={`flex items-center gap-1 py-0.5 px-2 rounded cursor-pointer select-none mb-0.5 ${node.status !== "unchanged" ? styles.bg : ""}`}
        onClick={() => setExpanded(e => !e)}
      >
        <svg
          className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {keyEl}
        {keyName !== undefined && <span className="text-muted-foreground/60 font-mono text-xs">:</span>}
        <span className="font-mono text-xs text-foreground">{openBracket}</span>
        {!expanded && <span className="font-mono text-xs text-muted-foreground">…</span>}
        {!expanded && <span className="font-mono text-xs text-foreground">{closeBracket}</span>}
        {statusBadge}
      </div>
      {expanded && (
        <>
          {entries.map(([k, n]) => (
            <DiffNodeView key={k} keyName={k} node={n as DiffNode} depth={depth + 1} />
          ))}
          <div className="px-2">
            <span className="font-mono text-xs text-foreground">{closeBracket}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── ViewerTab ────────────────────────────────────────────────────────────────

function ViewerTab({ initialJson }: { initialJson?: unknown } = {}) {
  const { toast } = useToast();
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<JsonValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandSignal, setExpandSignal] = useState<boolean | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (initialJson === undefined) return;
    const text = JSON.stringify(initialJson, null, 2);
    setRaw(text);
    setError(null);
    setParsed(initialJson as JsonValue);
    setSearch("");
    setExpandSignal(null);
  }, [initialJson]);

  function handleInput(text: string) {
    setRaw(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!text.trim()) { setParsed(null); setError(null); return; }
      const result = parseJson(text);
      if (result.error) {
        setError(result.error);
        setParsed(null);
      } else {
        setError(null);
        setParsed(result.value);
      }
    }, 300);
  }

  function handlePrettyPrint() {
    if (parsed !== null) { setRaw(prettyPrint(parsed)); }
  }

  function handleMinify() {
    if (parsed !== null) { setRaw(minify(parsed)); }
  }

  function handleDownload() {
    if (!raw.trim()) return;
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "data.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: `${label} copied`, description: text.length > 80 ? text.slice(0, 80) + "…" : text, duration: 2000 });
    }).catch(() => {});
  }, [toast]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-shrink-0 p-4 border-b border-accent space-y-3">
        <textarea
          value={raw}
          onChange={e => handleInput(e.target.value)}
          placeholder='Paste JSON here… e.g. {"name": "Shane", "role": "architect"}'
          className="w-full h-36 bg-background border border-border rounded-lg px-3 py-2.5 font-mono text-xs text-foreground placeholder-muted-foreground/60 resize-y focus:outline-none focus:border-primary/60 transition-colors"
          spellCheck={false}
        />

        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-mono text-xs text-red-400">{error}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handlePrettyPrint}
            disabled={!parsed}
            className="px-3 py-1.5 text-xs font-medium bg-accent border border-border text-foreground rounded-lg hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Pretty Print
          </button>
          <button
            onClick={handleMinify}
            disabled={!parsed}
            className="px-3 py-1.5 text-xs font-medium bg-accent border border-border text-foreground rounded-lg hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Minify
          </button>
          <button
            onClick={handleDownload}
            disabled={!raw.trim()}
            className="px-3 py-1.5 text-xs font-medium bg-accent border border-border text-foreground rounded-lg hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Download .json
          </button>

          <div className="flex-1" />

          {parsed !== null && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setExpandSignal(true)}
                className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
              >
                Expand All
              </button>
              <button
                onClick={() => setExpandSignal(false)}
                className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
              >
                Collapse All
              </button>
            </div>
          )}
        </div>

        {parsed !== null && (
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter keys or values…"
              className="w-full pl-8 pr-3 py-1.5 bg-background border border-border rounded-lg text-xs text-foreground placeholder-muted-foreground/60 focus:outline-none focus:border-primary/60 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {parsed === null && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-muted-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-muted-foreground">Paste JSON above to explore</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Objects, arrays, strings, numbers and booleans are all supported</p>
          </div>
        )}

        {parsed !== null && (
          <div className="bg-background border border-accent rounded-lg p-3 font-mono">
            <JsonNode
              value={parsed}
              path={[]}
              depth={0}
              search={search}
              expandAll={expandSignal}
              onCopy={handleCopy}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DiffTab ──────────────────────────────────────────────────────────────────

function DiffTab() {
  const [leftRaw, setLeftRaw] = useState("");
  const [rightRaw, setRightRaw] = useState("");
  const [leftError, setLeftError] = useState<string | null>(null);
  const [rightError, setRightError] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<DiffNode | null>(null);
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleCompare(left: string, right: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runCompare(left, right), 400);
  }

  function runCompare(left: string, right: string) {
    const l = parseJson(left);
    const r = parseJson(right);
    setLeftError(l.error);
    setRightError(r.error);
    if (l.error || r.error || !left.trim() || !right.trim()) {
      setDiffResult(null);
      setSummary(null);
      return;
    }
    const result = diffValues(l.value, r.value);
    setDiffResult(result);
    setSummary(computeSummary(result));
  }

  function handleLeftChange(text: string) {
    setLeftRaw(text);
    scheduleCompare(text, rightRaw);
  }

  function handleRightChange(text: string) {
    setRightRaw(text);
    scheduleCompare(leftRaw, text);
  }

  function handleSwap() {
    setLeftRaw(rightRaw);
    setRightRaw(leftRaw);
    scheduleCompare(rightRaw, leftRaw);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-4 border-b border-accent">
        <div className="flex items-center gap-3 mb-3">
          <p className="text-xs font-semibold text-foreground">Compare two JSON payloads</p>
          <div className="flex-1" />
          <button
            onClick={handleSwap}
            disabled={!leftRaw && !rightRaw}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent border border-border text-foreground rounded-lg hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            Swap
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Left (Original)</label>
            <textarea
              value={leftRaw}
              onChange={e => handleLeftChange(e.target.value)}
              placeholder='{"before": "value"}'
              className="w-full h-32 bg-background border border-border rounded-lg px-3 py-2 font-mono text-xs text-foreground placeholder-muted-foreground/60 resize-none focus:outline-none focus:border-primary/60 transition-colors"
              spellCheck={false}
            />
            {leftError && (
              <p className="font-mono text-xs text-red-400 mt-1 truncate" title={leftError}>
                ⚠ {leftError}
              </p>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Right (Modified)</label>
            <textarea
              value={rightRaw}
              onChange={e => handleRightChange(e.target.value)}
              placeholder='{"after": "value"}'
              className="w-full h-32 bg-background border border-border rounded-lg px-3 py-2 font-mono text-xs text-foreground placeholder-muted-foreground/60 resize-none focus:outline-none focus:border-primary/60 transition-colors"
              spellCheck={false}
            />
            {rightError && (
              <p className="font-mono text-xs text-red-400 mt-1 truncate" title={rightError}>
                ⚠ {rightError}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {!diffResult && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-muted-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-muted-foreground">Paste JSON in both panels to compare</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Differences are highlighted automatically</p>
          </div>
        )}

        {diffResult && summary && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {summary.added > 0 && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                  +{summary.added} added
                </span>
              )}
              {summary.removed > 0 && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                  −{summary.removed} removed
                </span>
              )}
              {summary.changed > 0 && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                  ~{summary.changed} changed
                </span>
              )}
              {summary.added === 0 && summary.removed === 0 && summary.changed === 0 && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent text-muted-foreground border border-border">
                  Identical — no differences
                </span>
              )}
            </div>

            <div className="bg-background border border-accent rounded-lg p-3 font-mono">
              <DiffNodeView node={diffResult} depth={0} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── JsonViewerContent (shared, accepts initialJson) ─────────────────────────

export function JsonViewerContent({ initialJson }: { initialJson?: unknown } = {}) {
  const [activeTab, setActiveTab] = useState<"viewer" | "diff">("viewer");

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">
      <div className="flex-shrink-0 border-b border-accent px-4 pt-3">
        <div className="flex items-center gap-1">
          {(["viewer", "diff"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors capitalize ${
                activeTab === tab
                  ? "text-primary border-primary"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              {tab === "viewer" ? "Viewer" : "Diff"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {activeTab === "viewer" ? <ViewerTab initialJson={initialJson} /> : <DiffTab />}
      </div>
    </div>
  );
}

// ─── JsonViewer (page-level default export) ───────────────────────────────────

export default function JsonViewer() {
  return <JsonViewerContent />;
}
