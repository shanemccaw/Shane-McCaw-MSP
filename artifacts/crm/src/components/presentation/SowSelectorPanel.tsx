import { useState, useEffect, useRef } from "react";

interface SowPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  selected: boolean;
  deliveryDate?: string | null;
}

interface SowSelectorPanelProps {
  phases: SowPhase[];
  totalPrice: number;
  saving: boolean;
  readOnly?: boolean;
  onReady?: () => void;
  onTogglePhase: (phaseId: string) => void;
  scopedSowHtml?: string | null;
  originalSowHtml?: string | null;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export default function SowSelectorPanel({
  phases,
  totalPrice,
  saving,
  readOnly = false,
  onReady,
  onTogglePhase,
  scopedSowHtml,
  originalSowHtml,
}: SowSelectorPanelProps) {
  const [mobileTab, setMobileTab] = useState<"scope" | "doc">("scope");
  // Separate heights for each document so toggling never resets the layout.
  const [scopedIframeHeight, setScopedIframeHeight] = useState(600);
  const [fullIframeHeight, setFullIframeHeight] = useState(600);

  // viewMode controls which document is shown when both exist.
  // Defaults to "scoped" whenever a scoped SOW is present.
  // Resets to "scoped" when scopedSowHtml transitions from null → value.
  // Resets to "full" when scopedSowHtml transitions from value → null.
  const [viewMode, setViewMode] = useState<"scoped" | "full">(
    scopedSowHtml ? "scoped" : "full"
  );
  const prevScopedRef = useRef<string | null | undefined>(scopedSowHtml);

  useEffect(() => {
    const prev = prevScopedRef.current;
    prevScopedRef.current = scopedSowHtml;
    if (!prev && scopedSowHtml) {
      // Scoped SOW just became available → show it
      setViewMode("scoped");
    } else if (prev && !scopedSowHtml) {
      // Scoped SOW was cleared → fall back to full
      setViewMode("full");
    }
  }, [scopedSowHtml]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { onReady?.(); });
    return () => cancelAnimationFrame(raf);
  }, [onReady]);

  const selectedPhases = phases.filter(p => p.selected);
  const selectedTotal = selectedPhases.reduce((sum, p) => sum + p.price, 0);
  const displayTotal = readOnly ? totalPrice : (selectedTotal || totalPrice);

  const hasScopeReduction = phases.length > 0 && selectedPhases.length < phases.length;
  // Toggle is shown when a scoped SOW exists AND either:
  //   a) the client has deselected at least one phase (interactive scoping), or
  //   b) the panel is in read-only mode (post-sign) — the scope was already committed.
  const showToggle = !!scopedSowHtml && (readOnly || hasScopeReduction);

  // When the toggle is not active, show whichever document is available.
  const fallbackHtml = originalSowHtml ?? null;

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Mobile tab bar — only visible below md */}
      <div className="md:hidden flex-shrink-0 flex border-b border-border bg-white">
        <button
          onClick={() => setMobileTab("scope")}
          className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors border-b-2 ${
            mobileTab === "scope"
              ? "text-[#0078D4] border-[#0078D4]"
              : "text-muted-foreground border-transparent"
          }`}
        >
          Select Scope
        </button>
        <button
          onClick={() => setMobileTab("doc")}
          className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors border-b-2 ${
            mobileTab === "doc"
              ? "text-[#0078D4] border-[#0078D4]"
              : "text-muted-foreground border-transparent"
          }`}
        >
          Preview
        </button>
      </div>

      {/* Panels container */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">

        {/* LEFT: Phase selector — full-width on mobile, w-72 sidebar on desktop */}
        <div className={`${mobileTab === "scope" ? "flex" : "hidden"} md:flex flex-col w-full md:w-72 md:flex-shrink-0 border-b md:border-b-0 md:border-r border-border bg-white min-h-0`}>
          {/* Header */}
          <div className="px-4 pt-4 pb-3 flex-shrink-0">
            <h2 className="text-sm font-extrabold text-[#0A2540]">Select Your Scope</h2>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {readOnly
                ? "Phases included in this engagement."
                : "Deselect any phases you'd like to defer."}
            </p>
          </div>

          {/* Scrollable phase list */}
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2 min-h-0">
            {phases.map((phase) => (
              <div
                key={phase.id}
                onClick={() => !readOnly && !saving && onTogglePhase(phase.id)}
                className={`rounded-xl border-2 p-3 transition-all select-none ${
                  readOnly
                    ? "cursor-default"
                    : "cursor-pointer hover:border-[#0078D4]/60"
                } ${
                  phase.selected
                    ? "border-[#0078D4] bg-[#0078D4]/5"
                    : "border-border bg-white"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {!readOnly && (
                    <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      phase.selected
                        ? "border-[#0078D4] bg-[#0078D4]"
                        : "border-gray-300 bg-white"
                    }`}>
                      {phase.selected && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs font-bold leading-snug ${phase.selected ? "text-[#0A2540]" : "text-gray-400"}`}>
                        {phase.title}
                      </p>
                      <span className={`text-xs font-extrabold whitespace-nowrap flex-shrink-0 ${
                        phase.selected ? "text-[#0078D4]" : "text-gray-300"
                      }`}>
                        {formatCurrency(phase.price)}
                      </span>
                    </div>
                    {phase.description && (
                      <p className={`text-xs mt-1 leading-relaxed ${phase.selected ? "text-muted-foreground" : "text-gray-300"}`}>
                        {phase.description}
                      </p>
                    )}
                    {phase.deliveryDate && (
                      <p className={`text-[10px] mt-1 font-medium ${phase.selected ? "text-[#0078D4]/70" : "text-gray-300"}`}>
                        Est. delivery:{" "}
                        {new Date(phase.deliveryDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pinned total footer */}
          <div className="flex-shrink-0 border-t border-border px-4 py-3">
            <div className="flex items-center justify-between mb-0.5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {readOnly ? "Total Investment" : hasScopeReduction ? "Selected Total" : "Total Investment"}
              </p>
              {!readOnly && (
                <p className="text-xs text-muted-foreground">
                  {selectedPhases.length}/{phases.length} phases
                </p>
              )}
            </div>
            <p className="text-2xl font-extrabold text-[#0A2540]">{formatCurrency(displayTotal)}</p>
            {saving && (
              <div className="flex items-center gap-1.5 text-xs text-[#0078D4] mt-1">
                <div className="w-3 h-3 border border-[#0078D4]/30 border-t-[#0078D4] rounded-full animate-spin" />
                Saving…
              </div>
            )}
            {showToggle && !readOnly && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold mt-1.5">
                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Scoped SOW ready
              </div>
            )}
            {/* On mobile, link to switch to the document preview tab */}
            {(scopedSowHtml || fallbackHtml) && (
              <button
                onClick={() => setMobileTab("doc")}
                className="md:hidden mt-2 w-full text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors"
              >
                View document preview →
              </button>
            )}
          </div>
        </div>

        {/* RIGHT: Document viewer */}
        <div className={`${mobileTab === "doc" ? "flex" : "hidden"} md:flex flex-1 flex-col min-h-0`}>

          {/* ── Toggle control (replaces the old label strip when scoped SOW exists) ── */}
          {showToggle ? (
            <div className="flex-shrink-0 flex flex-col gap-0 border-b border-[#0078D4]/20 bg-[#EBF5FF] px-4 py-2.5">
              {/* Pill toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-white/70 border border-[#0078D4]/20 rounded-full p-0.5">
                  <button
                    onClick={() => setViewMode("scoped")}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                      viewMode === "scoped"
                        ? "bg-[#0078D4] text-white shadow-sm"
                        : "text-slate-500 hover:text-[#0078D4]"
                    }`}
                  >
                    Scoped SOW
                  </button>
                  <button
                    onClick={() => setViewMode("full")}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                      viewMode === "full"
                        ? "bg-[#0078D4] text-white shadow-sm"
                        : "text-slate-500 hover:text-[#0078D4]"
                    }`}
                  >
                    Full SOW
                  </button>
                </div>
                <span className="text-xs font-bold text-[#0078D4]">
                  {formatCurrency(displayTotal)}
                </span>
              </div>
            </div>
          ) : (
            /* Original label strip — shown only when no scoped SOW exists */
            fallbackHtml && (
              <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b bg-slate-50 border-border">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                    Full Statement of Work
                  </span>
                </div>
                <span className="text-xs font-bold text-slate-500">
                  {formatCurrency(displayTotal)}
                </span>
              </div>
            )
          )}

          {/* "Superseded" notice — shown below the toggle when viewing the Full SOW */}
          {showToggle && viewMode === "full" && (
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
              <svg className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-slate-500">
                This is the original full-scope version. The{" "}
                <button
                  onClick={() => setViewMode("scoped")}
                  className="font-semibold text-[#0078D4] hover:underline"
                >
                  Scoped SOW
                </button>{" "}
                is the active document for this engagement.
              </p>
            </div>
          )}

          {/* SOW iframe(s) — both rendered once; inactive one hidden via CSS so scroll
              position and iframe height are preserved on toggle. Uses overflow-y-scroll
              on the wrapper (not absolute/h-full on the iframe) so iOS Safari can scroll
              in both directions inside fixed overlays. */}
          {(showToggle || fallbackHtml) ? (
            <div
              className="flex-1 min-h-0 overflow-y-scroll"
              style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
            >
              {/* Scoped SOW — rendered only when the toggle is active so it never
                  stacks with the full iframe in single-document mode */}
              {showToggle && scopedSowHtml && (
                <iframe
                  srcDoc={scopedSowHtml}
                  title="Scoped Statement of Work"
                  className="w-full border-0 block"
                  style={{
                    height: scopedIframeHeight,
                    display: showToggle && viewMode !== "scoped" ? "none" : undefined,
                  }}
                  sandbox="allow-same-origin"
                  onLoad={(e) => {
                    const h = e.currentTarget.contentDocument?.body?.scrollHeight;
                    if (h) setScopedIframeHeight(Math.max(600, h + 32));
                  }}
                />
              )}
              {/* Full / original SOW */}
              {(originalSowHtml ?? fallbackHtml) && (
                <iframe
                  srcDoc={(originalSowHtml ?? fallbackHtml)!}
                  title="Full Statement of Work"
                  className="w-full border-0 block"
                  style={{
                    height: fullIframeHeight,
                    display: showToggle && viewMode !== "full" ? "none" : undefined,
                  }}
                  sandbox="allow-same-origin"
                  onLoad={(e) => {
                    const h = e.currentTarget.contentDocument?.body?.scrollHeight;
                    if (h) setFullIframeHeight(Math.max(600, h + 32));
                  }}
                />
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              No document available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
