import { useState, useEffect } from "react";

interface SowPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  selected: boolean;
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
  const [docIframeHeight, setDocIframeHeight] = useState(600);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { onReady?.(); });
    return () => cancelAnimationFrame(raf);
  }, [onReady]);

  const selectedPhases = phases.filter(p => p.selected);
  const selectedTotal = selectedPhases.reduce((sum, p) => sum + p.price, 0);
  const displayTotal = readOnly ? totalPrice : (selectedTotal || totalPrice);

  const hasScopeReduction = phases.length > 0 && selectedPhases.length < phases.length;
  const showScoped = !!scopedSowHtml && hasScopeReduction;
  const activeHtml = showScoped ? scopedSowHtml : originalSowHtml;
  const docLabel = showScoped ? "Scoped Statement of Work" : "Full Statement of Work";

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
            {showScoped && !readOnly && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold mt-1.5">
                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Scoped SOW ready
              </div>
            )}
            {/* On mobile, link to switch to the document preview tab */}
            {activeHtml && (
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
          {/* Document label strip */}
          {activeHtml && (
            <div className={`flex-shrink-0 flex items-center justify-between px-4 py-2 border-b ${
              showScoped
                ? "bg-[#EBF5FF] border-[#0078D4]/20"
                : "bg-slate-50 border-border"
            }`}>
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${showScoped ? "bg-[#0078D4]" : "bg-slate-400"}`} />
                <span className={`text-xs font-bold uppercase tracking-widest ${
                  showScoped ? "text-[#0078D4]" : "text-slate-500"
                }`}>
                  {docLabel}
                </span>
              </div>
              <span className={`text-xs font-bold ${showScoped ? "text-[#0078D4]" : "text-slate-500"}`}>
                {formatCurrency(displayTotal)}
              </span>
            </div>
          )}

          {/* SOW iframe — fills remaining height.
              Uses overflow-y-scroll on the wrapper (not absolute/h-full on the iframe)
              so iOS Safari can scroll in both directions inside fixed overlays. */}
          {activeHtml ? (
            <div
              className="flex-1 min-h-0 overflow-y-scroll"
              style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
            >
              <iframe
                key={showScoped ? "scoped" : "original"}
                srcDoc={activeHtml}
                title={docLabel}
                className="w-full border-0 block"
                style={{ height: docIframeHeight }}
                sandbox="allow-same-origin"
                onLoad={(e) => {
                  const h = e.currentTarget.contentDocument?.body?.scrollHeight;
                  if (h) setDocIframeHeight(Math.max(600, h + 32));
                }}
              />
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
