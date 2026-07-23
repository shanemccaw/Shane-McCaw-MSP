// artifacts/admin-panel/src/components/JsonResponseViewer.tsx
//
// Reusable formatted-JSON + Raw viewer with a copy button.
//
// Built as a shared component rather than inline in the M365 Endpoints view
// because the "copy button + JSON viewer + raw tab" pattern applies broadly
// across the admin panel, not just to monitor-check responses. An audit found
// no existing component doing this (EngineConfigViewer / ImportJsonDialog /
// JsonImportModal are all import-or-config specific), so this is the first one.
//
// "Formatted" = JSON.stringify(value, null, 2). "Raw" = the response exactly as
// received when the caller passes rawText, falling back to compact JSON. Keeping
// Raw honest matters here: a Graph usage report comes back as CSV, not JSON, and
// pretty-printing it would misrepresent what the tenant actually returned.

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function JsonResponseViewer({
  value,
  rawText,
  emptyLabel = "No response yet",
  className = "",
}: {
  /** The parsed value to pretty-print on the Formatted tab. */
  value: unknown;
  /** The verbatim response body, when the caller has it (may be non-JSON). */
  rawText?: string;
  emptyLabel?: string;
  className?: string;
}) {
  const [tab, setTab] = useState<"formatted" | "raw">("formatted");
  const [copied, setCopied] = useState(false);

  const formatted = safeStringify(value, 2);
  const raw = rawText ?? safeStringify(value, 0);
  const shown = tab === "formatted" ? formatted : raw;
  const isEmpty = value === undefined && !rawText;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked by permissions/insecure context — stay silent
      // rather than throwing a toast the user can't act on.
    }
  };

  return (
    <div className={`flex min-h-0 flex-col rounded border border-border bg-background ${className}`}>
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-border bg-card px-1.5 select-none">
        <div className="flex h-full items-center">
          {(
            [
              { key: "formatted", label: "Formatted" },
              { key: "raw", label: "Raw" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`relative h-full px-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                tab === key
                  ? "text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={handleCopy}
          disabled={isEmpty}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          title="Copy to clipboard"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {isEmpty ? (
          <div className="px-3 py-4 text-[11px] italic text-muted-foreground/70">{emptyLabel}</div>
        ) : (
          <pre className="whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/90">
            {shown}
          </pre>
        )}
      </div>
    </div>
  );
}

/** JSON.stringify throws on circular refs — a viewer must never crash the page. */
function safeStringify(value: unknown, indent: number): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, indent) ?? String(value);
  } catch {
    return String(value);
  }
}
