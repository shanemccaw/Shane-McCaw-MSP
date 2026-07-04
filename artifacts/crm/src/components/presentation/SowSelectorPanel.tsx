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
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
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

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Phase selector section */}
      <div className="flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="mb-5 flex-shrink-0">
          <h2 className="text-xl font-extrabold text-[#0A2540]">Select Your Scope</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {readOnly
              ? "Review the phases included in this engagement."
              : "Choose the phases you'd like to include. Deselect any you want to defer."
            }
          </p>
        </div>

        {/* Phase list */}
        <div className="space-y-3 mb-4">
          {phases.map((phase) => (
            <div
              key={phase.id}
              onClick={() => !readOnly && !saving && onTogglePhase(phase.id)}
              className={`relative rounded-xl border-2 p-4 transition-all ${
                readOnly
                  ? "cursor-default"
                  : "cursor-pointer hover:border-[#0078D4]/60"
              } ${
                phase.selected
                  ? "border-[#0078D4] bg-[#0078D4]/5"
                  : "border-border bg-white"
              }`}
            >
              <div className="flex items-start gap-4">
                {!readOnly && (
                  <div className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    phase.selected
                      ? "border-[#0078D4] bg-[#0078D4]"
                      : "border-gray-300 bg-white"
                  }`}>
                    {phase.selected && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h3 className={`text-sm font-bold ${phase.selected ? "text-[#0A2540]" : "text-gray-500"}`}>
                      {phase.title}
                    </h3>
                    <span className={`text-sm font-extrabold whitespace-nowrap ${phase.selected ? "text-[#0078D4]" : "text-gray-400"}`}>
                      {formatCurrency(phase.price)}
                    </span>
                  </div>
                  {phase.description && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {phase.description}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Total */}
        <div className="flex-shrink-0 bg-white rounded-xl border-2 border-[#0078D4]/30 p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {readOnly ? "Total Investment" : "Selected Total"}
              </p>
              <p className="text-2xl font-extrabold text-[#0A2540] mt-0.5">
                {formatCurrency(readOnly ? totalPrice : selectedTotal)}
              </p>
            </div>
            {!readOnly && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">{selectedPhases.length} of {phases.length} phases selected</p>
                {saving && (
                  <div className="flex items-center gap-1 text-xs text-[#0078D4] mt-1 justify-end">
                    <div className="w-3 h-3 border border-[#0078D4]/30 border-t-[#0078D4] rounded-full animate-spin" />
                    Saving…
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Original SOW document — shown whenever the original HTML is available */}
      {originalSowHtml && (
        <div className="flex-shrink-0 flex flex-col gap-0 mt-2">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-slate-200" />
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200">
              <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-xs font-bold text-slate-500 whitespace-nowrap">Full Statement of Work</span>
            </div>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
          <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm" style={{ height: "480px" }}>
            <iframe
              srcDoc={originalSowHtml}
              title="Full Statement of Work"
              className="w-full h-full border-0"
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      )}

      {/* Scoped SOW document — shown below the original after regeneration */}
      {scopedSowHtml && (
        <div className="flex-shrink-0 flex flex-col gap-0 mt-4">
          {/* Divider / label */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-[#0078D4]/20" />
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#0078D4]/10 border border-[#0078D4]/25">
              <svg className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-xs font-bold text-[#0078D4] whitespace-nowrap">Scoped Statement of Work — your current selection</span>
            </div>
            <div className="flex-1 h-px bg-[#0078D4]/20" />
          </div>

          {/* Scoped SOW iframe */}
          <div className="rounded-xl border border-[#0078D4]/30 overflow-hidden shadow-sm" style={{ height: "480px" }}>
            <iframe
              srcDoc={scopedSowHtml}
              title="Scoped Statement of Work"
              className="w-full h-full border-0"
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      )}
    </div>
  );
}
