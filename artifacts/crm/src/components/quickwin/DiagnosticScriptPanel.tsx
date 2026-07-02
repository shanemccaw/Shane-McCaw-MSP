import { useState } from "react";
import { ManualScriptUploadCard, type ManualScriptRecord } from "@/components/ManualScriptUploadCard";

interface ScriptEntry extends ManualScriptRecord {
  projectId: number;
}

interface Props {
  scripts: ScriptEntry[];
  onCompleted: () => void;
  onAllDismissed: () => void;
}

interface ScriptState {
  dismissed: boolean;
  confirmingDismiss: boolean;
}

export default function DiagnosticScriptPanel({ scripts, onCompleted, onAllDismissed }: Props) {
  const [scriptStates, setScriptStates] = useState<Record<number, ScriptState>>(
    () => Object.fromEntries(scripts.map(s => [s.runResultId, { dismissed: false, confirmingDismiss: false }]))
  );

  const visible = scripts.filter(s => !scriptStates[s.runResultId]?.dismissed);

  function startDismiss(id: number) {
    setScriptStates(prev => ({ ...prev, [id]: { ...prev[id]!, confirmingDismiss: true } }));
  }

  function cancelDismiss(id: number) {
    setScriptStates(prev => ({ ...prev, [id]: { ...prev[id]!, confirmingDismiss: false } }));
  }

  function confirmDismiss(id: number) {
    setScriptStates(prev => {
      const next = { ...prev, [id]: { dismissed: true, confirmingDismiss: false } };
      const allGone = scripts.every(s => next[s.runResultId]?.dismissed);
      if (allGone) setTimeout(onAllDismissed, 120);
      return next;
    });
  }

  if (visible.length === 0) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0 relative z-10">
      {/* ── Hero header ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-gradient-to-r from-amber-500 to-orange-500 px-8 py-5 flex items-center gap-4">
        {/* Pulsing attention dot */}
        <span className="relative flex-shrink-0">
          <span className="absolute inline-flex h-4 w-4 rounded-full bg-white opacity-50 animate-ping" />
          <span className="relative inline-flex rounded-full h-4 w-4 bg-white" />
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-white font-black text-base leading-tight">
            Your diagnostic needs one more step
          </p>
          <p className="text-white/75 text-xs mt-0.5 leading-snug">
            {visible.length === 1
              ? "One script must run locally — some data can only be collected with direct access to your environment."
              : `${visible.length} scripts must run locally — some data can only be collected with direct access to your environment.`}
          </p>
        </div>

        {/* Script count badge */}
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-white/20 border border-white/30 flex items-center justify-center">
          <span className="text-white font-black text-sm">{visible.length}</span>
        </div>
      </div>

      {/* ── What this unlocks ───────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-8 py-3 bg-amber-50 border-b border-amber-200 flex items-start gap-2.5">
        <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>
        <p className="text-xs text-amber-800 leading-relaxed">
          <span className="font-bold">Completing this unlocks your full M365 health score.</span>{" "}
          Shane uses this data to identify security gaps and optimisation opportunities your tenant can't surface automatically.
        </p>
      </div>

      {/* ── Scrollable card area ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        {visible.map(script => {
          const st = scriptStates[script.runResultId];
          return (
            <div key={script.runResultId} className="space-y-3">
              {/* The upload card itself */}
              <ManualScriptUploadCard
                script={script}
                projectId={script.projectId}
                onCompleted={onCompleted}
              />

              {/* Dismiss footer for this script */}
              {!st?.confirmingDismiss ? (
                <div className="flex items-center justify-end px-1">
                  <button
                    onClick={() => startDismiss(script.runResultId)}
                    className="flex items-center gap-1.5 text-xs text-[#0A2540]/40 hover:text-[#0A2540]/70 font-medium transition-colors group"
                  >
                    <svg className="w-3.5 h-3.5 opacity-60 group-hover:opacity-90 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Skip this check
                  </button>
                </div>
              ) : (
                /* Dismiss confirmation */
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-red-100 border border-red-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-3 h-3 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-red-800 leading-snug">
                        Skip "{script.scriptName}"?
                      </p>
                      <p className="text-xs text-red-700/80 mt-1 leading-relaxed">
                        This data will be <span className="font-semibold">excluded from your M365 health assessment</span>. Shane may follow up separately to collect it — but your report will be incomplete until then.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => cancelDismiss(script.runResultId)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0A2540]/70 border border-[#0A2540]/15 hover:bg-white/70 transition-colors"
                    >
                      Keep it
                    </button>
                    <button
                      onClick={() => confirmDismiss(script.runResultId)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
                    >
                      Yes, skip &amp; exclude from results
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Bottom context strip ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-[#0A2540]/8 px-8 py-3 bg-white/60 flex items-center gap-2" style={{ backdropFilter: "blur(8px)" }}>
        <svg className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
        <p className="text-[11px] text-[#0A2540]/50">
          Your script runs locally on your machine — no credentials are sent to Shane or stored on our servers. The JSON output file is the only thing uploaded.
        </p>
      </div>
    </div>
  );
}
