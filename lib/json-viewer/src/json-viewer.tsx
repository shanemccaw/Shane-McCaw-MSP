// lib/json-viewer/src/json-viewer.tsx  (@workspace/json-viewer)
//
// Standalone, reusable pretty-JSON viewer: collapsible tree, per-node
// expand/collapse, search, a verbatim Raw tab, and copy-to-clipboard.
//
// Deliberately generic (#279): it knows nothing about debugging, network
// traffic, gating, or assessments — it takes a value and renders it. Anything
// caller-specific (which data is safe to show, labels, framing) belongs in the
// wrapper, not here. Known consumers: the testbed-gated Copilot-assessment
// debug panel and the requireAdmin-gated admin-panel debug panel (both
// internal live state + network log), and later the customer-facing Security
// page's "now -> new" comparison (#262).
//
// Why this lives in lib/* rather than in one app's src (#285): it was written
// inside msp-portal when both known consumers were in that app. admin-panel is
// now a second real consumer, and admin-panel/msp-portal are separate Vite apps
// with no cross-app import path (each app's tsconfig `paths` is only
// `@/* -> ./src/*`, each vite alias set is only `@`/`@assets`, and vite's
// `server.fs.strict` blocks reaching outside the app root). A workspace package
// is the only way two apps share one copy — and 500+ lines of tree/search/
// circular-ref handling is exactly the kind of thing that must not fork.
//
// ⚠️ CONSUMING APPS MUST REGISTER THIS PACKAGE WITH TAILWIND. Tailwind v4's
// automatic source detection does not look inside workspace packages, so an app
// that only adds the dependency renders this component unstyled. Each consumer's
// entry CSS needs, next to `@import "tailwindcss"`:
//
//     @source "../../../lib/json-viewer/src";
//
// (Verified by build, not assumed: classes that exist only in a lib/* package
// are otherwise absent from the app's emitted CSS.) The classes used here are
// all semantic-token or plain-palette utilities that both apps already define.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Search, X } from "lucide-react";

/** Arrays/objects longer than this render a "show all" expander rather than
 *  dumping thousands of rows — never a silent truncation. */
const CHUNK_SIZE = 200;

export type JsonViewerProps = {
  /** The value to render as a tree. Anything JSON-shaped; circular refs are safe. */
  value: unknown;
  /** Verbatim response body when the caller has it and it may not be JSON (CSV, HTML, …). */
  rawText?: string;
  /** Label for the root node. */
  rootLabel?: string;
  emptyLabel?: string;
  className?: string;
  /** Nodes shallower than this start expanded. */
  initialExpandDepth?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  showRawTab?: boolean;
  showCopy?: boolean;
  /** Hide the whole top bar (tabs/search/copy) for a bare inline tree. */
  showToolbar?: boolean;
};

export function JsonViewer({
  value,
  rawText,
  rootLabel = "root",
  emptyLabel = "No data",
  className = "",
  initialExpandDepth = 2,
  searchable = true,
  searchPlaceholder = "Search keys and values…",
  showRawTab = true,
  showCopy = true,
  showToolbar = true,
}: JsonViewerProps) {
  const [tab, setTab] = useState<"tree" | "raw">("tree");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  // Per-node overrides on top of the depth-based default, so "expand all" /
  // "collapse all" is just a change of that default rather than a walk of the
  // whole (possibly huge) value.
  const [baseDepth, setBaseDepth] = useState(initialExpandDepth);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const isEmpty = value === undefined && rawText === undefined;
  const pretty = useMemo(() => safeStringify(value, 2), [value]);
  const compact = useMemo(() => safeStringify(value, 0), [value]);
  const raw = rawText ?? compact;

  const trimmedQuery = query.trim();
  const matchIndex = useMemo(
    () => (trimmedQuery ? buildMatchIndex(value, trimmedQuery) : null),
    [value, trimmedQuery],
  );

  const toggle = useCallback((path: string, next: boolean) => {
    setOverrides((prev) => ({ ...prev, [path]: next }));
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(tab === "raw" ? raw : pretty);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is blocked in insecure contexts / without permission —
      // stay silent rather than throwing an error the user can't act on.
    }
  }, [tab, raw, pretty]);

  const ctx: TreeCtx = {
    baseDepth,
    overrides,
    toggle,
    query: trimmedQuery,
    matchIndex,
  };

  return (
    <div className={`flex min-h-0 min-w-0 flex-col rounded border border-border bg-background ${className}`}>
      {showToolbar && (
        <div className="flex shrink-0 flex-col border-b border-border bg-card">
          <div className="flex h-7 items-center justify-between px-1.5 select-none">
            <div className="flex h-full items-center">
              {showRawTab ? (
                (
                  [
                    { key: "tree", label: "Tree" },
                    { key: "raw", label: "Raw" },
                  ] as const
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`relative h-full px-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                      tab === key
                        ? "text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))
              ) : (
                <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {rootLabel}
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              {tab === "tree" && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setOverrides({});
                      setBaseDepth(Number.POSITIVE_INFINITY);
                    }}
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Expand all"
                  >
                    Expand
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOverrides({});
                      setBaseDepth(0);
                    }}
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Collapse all"
                  >
                    Collapse
                  </button>
                </>
              )}
              {showCopy && (
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={isEmpty}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                  title="Copy to clipboard"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>

          {searchable && tab === "tree" && (
            <div className="flex h-7 items-center gap-1.5 border-t border-border/60 px-2">
              <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              {trimmedQuery && (
                <>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {matchIndex?.count ?? 0} match{(matchIndex?.count ?? 0) === 1 ? "" : "es"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {isEmpty ? (
          <div className="px-3 py-4 text-[11px] italic text-muted-foreground/70">{emptyLabel}</div>
        ) : tab === "raw" ? (
          <pre className="px-3 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-foreground/90">
            {raw}
          </pre>
        ) : trimmedQuery && (matchIndex?.count ?? 0) === 0 ? (
          <div className="px-3 py-4 text-[11px] italic text-muted-foreground/70">
            No key or value matches “{trimmedQuery}”.
          </div>
        ) : (
          <div className="px-2 py-1.5 font-mono text-[11px] leading-relaxed">
            <JsonNode
              label={rootLabel}
              value={value}
              path="$"
              depth={0}
              isArrayItem={false}
              underMatch={false}
              ancestors={[]}
              ctx={ctx}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tree ──────────────────────────────────────────────────────────────────────

type MatchIndex = {
  /** Paths of nodes whose own key or primitive value matches. */
  matches: Set<string>;
  /** Matches plus every ancestor path needed to reach them. */
  keep: Set<string>;
  count: number;
};

type TreeCtx = {
  baseDepth: number;
  overrides: Record<string, boolean>;
  toggle: (path: string, next: boolean) => void;
  query: string;
  matchIndex: MatchIndex | null;
};

function JsonNode({
  label,
  value,
  path,
  depth,
  isArrayItem,
  underMatch,
  ancestors,
  ctx,
}: {
  label: string;
  value: unknown;
  path: string;
  depth: number;
  isArrayItem: boolean;
  /** True once some ancestor was itself a search match — its whole subtree shows. */
  underMatch: boolean;
  /** Container instances on the path to here, so a circular ref renders instead of hanging. */
  ancestors: object[];
  ctx: TreeCtx;
}) {
  const [showAll, setShowAll] = useState(false);
  const { matchIndex } = ctx;

  if (matchIndex && !underMatch && !matchIndex.keep.has(path)) return null;

  const circular = isContainer(value) && ancestors.includes(value as object);
  const container = isContainer(value) && !circular;
  const selfMatch = matchIndex?.matches.has(path) ?? false;
  const nowUnderMatch = underMatch || selfMatch;

  // While searching, ancestors-of-matches are forced open so the hit is
  // visible without hand-expanding down to it. A matched node keeps its own
  // expansion state so its subtree can still be collapsed.
  const forcedOpen = matchIndex != null && !selfMatch && matchIndex.keep.has(path);
  const expanded = forcedOpen || (ctx.overrides[path] ?? depth < ctx.baseDepth);

  const entries = container ? entriesOf(value) : [];
  const visibleEntries = showAll ? entries : entries.slice(0, CHUNK_SIZE);
  const hiddenCount = entries.length - visibleEntries.length;

  return (
    <div className={depth === 0 ? "" : "border-l border-border/40 pl-2"}>
      <div className="flex items-start gap-1">
        {container && entries.length > 0 ? (
          <button
            type="button"
            onClick={() => ctx.toggle(path, !expanded)}
            className="mt-[3px] shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="mt-[3px] h-3 w-3 shrink-0" />
        )}

        <div className="min-w-0 flex-1 break-words">
          <span className={isArrayItem ? "text-muted-foreground/70" : "text-sky-600 dark:text-sky-300"}>
            <Highlight text={label} query={ctx.query} />
          </span>
          <span className="text-muted-foreground">: </span>

          {circular ? (
            <span className="text-amber-600 italic dark:text-amber-400">[circular]</span>
          ) : container ? (
            <span className="text-muted-foreground/80">
              {summarize(value, entries.length)}
              {!expanded && entries.length > 0 && (
                <span className="ml-1 text-muted-foreground/50">{preview(value, entries)}</span>
              )}
            </span>
          ) : (
            <PrimitiveValue value={value} query={ctx.query} />
          )}
        </div>
      </div>

      {container && expanded && entries.length > 0 && (
        <div className="ml-[6px]">
          {visibleEntries.map(([key, child]) => (
            <JsonNode
              key={key}
              label={key}
              value={child}
              path={childPath(path, key, Array.isArray(value))}
              depth={depth + 1}
              isArrayItem={Array.isArray(value)}
              underMatch={nowUnderMatch}
              ancestors={[...ancestors, value as object]}
              ctx={ctx}
            />
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="ml-4 text-[10px] text-primary underline-offset-2 hover:underline"
            >
              show {hiddenCount} more…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PrimitiveValue({ value, query }: { value: unknown; query: string }) {
  if (typeof value === "string") {
    return (
      <span className="break-all text-emerald-700 dark:text-emerald-400">
        "<Highlight text={value} query={query} />"
      </span>
    );
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return (
      <span className="text-orange-600 tabular-nums dark:text-orange-400">
        <Highlight text={String(value)} query={query} />
      </span>
    );
  }
  if (typeof value === "boolean") {
    return (
      <span className="text-purple-600 dark:text-purple-400">
        <Highlight text={String(value)} query={query} />
      </span>
    );
  }
  if (value === null) return <span className="text-muted-foreground italic">null</span>;
  if (value === undefined) return <span className="text-muted-foreground italic">undefined</span>;
  // Functions, symbols, and anything else that isn't JSON-shaped — shown for
  // what it is rather than silently dropped the way JSON.stringify drops it.
  return <span className="text-muted-foreground italic">{String(value)}</span>;
}

/** Case-insensitive substring highlight. Plain text in, marked spans out. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let hit = lower.indexOf(needle);
  while (hit !== -1) {
    if (hit > cursor) parts.push(text.slice(cursor, hit));
    parts.push(
      <mark key={`${hit}`} className="rounded-[2px] bg-amber-300/60 text-inherit dark:bg-amber-500/40">
        {text.slice(hit, hit + needle.length)}
      </mark>,
    );
    cursor = hit + needle.length;
    hit = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

// ── Value helpers ─────────────────────────────────────────────────────────────

function isContainer(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/** Entries of an array or plain object as [key, value] pairs. */
function entriesOf(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.map((v, i) => [String(i), v]);
  if (value instanceof Map) return Array.from(value.entries()).map(([k, v]) => [String(k), v]);
  if (value instanceof Set) return Array.from(value.values()).map((v, i) => [String(i), v]);
  if (isContainer(value)) return Object.entries(value as Record<string, unknown>);
  return [];
}

function childPath(parent: string, key: string, isArray: boolean): string {
  return isArray ? `${parent}[${key}]` : `${parent}.${key}`;
}

function summarize(value: unknown, count: number): string {
  if (Array.isArray(value)) return `Array(${count})`;
  if (value instanceof Map) return `Map(${count})`;
  if (value instanceof Set) return `Set(${count})`;
  if (value instanceof Date) return value.toISOString();
  return count === 0 ? "{}" : `{${count}}`;
}

/** One-line hint of what's inside a collapsed container. */
function preview(value: unknown, entries: Array<[string, unknown]>): string {
  const shown = entries.slice(0, 4);
  const body = shown
    .map(([k, v]) => (Array.isArray(value) ? shortValue(v) : `${k}: ${shortValue(v)}`))
    .join(", ");
  const more = entries.length > shown.length ? ", …" : "";
  return Array.isArray(value) ? `[${body}${more}]` : `{ ${body}${more} }`;
}

function shortValue(value: unknown): string {
  if (typeof value === "string") return value.length > 20 ? `"${value.slice(0, 20)}…"` : `"${value}"`;
  if (isContainer(value)) return Array.isArray(value) ? `[…]` : "{…}";
  return String(value);
}

/** The text a search query is tested against for a primitive node. */
function primitiveText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return String(value);
}

function buildMatchIndex(root: unknown, query: string): MatchIndex {
  const needle = query.toLowerCase();
  const matches = new Set<string>();
  const keep = new Set<string>();

  const walk = (node: unknown, path: string, key: string | null, trail: string[], ancestors: object[]) => {
    const keyHit = key !== null && key.toLowerCase().includes(needle);
    const valueHit = !isContainer(node) && primitiveText(node).toLowerCase().includes(needle);
    if (keyHit || valueHit) {
      matches.add(path);
      for (const p of trail) keep.add(p);
      keep.add(path);
    }
    if (isContainer(node) && !ancestors.includes(node as object)) {
      const nextTrail = [...trail, path];
      const nextAncestors = [...ancestors, node as object];
      for (const [k, child] of entriesOf(node)) {
        walk(child, childPath(path, k, Array.isArray(node)), k, nextTrail, nextAncestors);
      }
    }
  };

  walk(root, "$", null, [], []);
  return { matches, keep, count: matches.size };
}

/** JSON.stringify throws on circular refs — a viewer must never crash the page. */
function safeStringify(value: unknown, indent: number): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, indent) ?? String(value);
  } catch {
    try {
      return JSON.stringify(value, circularSafeReplacer(), indent) ?? String(value);
    } catch {
      return String(value);
    }
  }
}

function circularSafeReplacer() {
  const seen = new WeakSet<object>();
  return (_key: string, val: unknown) => {
    if (typeof val === "object" && val !== null) {
      if (seen.has(val as object)) return "[circular]";
      seen.add(val as object);
    }
    return val;
  };
}
