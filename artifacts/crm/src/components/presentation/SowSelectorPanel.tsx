import { useEffect } from "react";

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
    <div className="flex h-full min-h-0">

      {/* LEFT: Phase selector */}
      <div className="w-72 flex-shrink-0 border-r border-border bg-white flex flex-col min-h-0">
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
        </div>
      </div>

      {/* RIGHT: Document viewer */}
      <div className="flex-1 flex flex-col min-h-0">
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

        {/* SOW iframe — fills remaining height */}
        {activeHtml ? (
          <div className="flex-1 min-h-0">
            <iframe
              key={showScoped ? "scoped" : "original"}
              srcDoc={activeHtml}
              title={docLabel}
              className="w-full h-full border-0"
              sandbox="allow-same-origin"
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            No document available
          </div>
        )}
      </div>
    </div>
  );
}
