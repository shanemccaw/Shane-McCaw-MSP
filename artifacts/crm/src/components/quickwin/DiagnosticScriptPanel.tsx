import { useState } from "react";
import { ManualScriptUploadCard, type ManualScriptRecord } from "@/components/ManualScriptUploadCard";

interface ScriptEntry extends ManualScriptRecord {
  projectId: number;
}

interface Props {
  scripts: ScriptEntry[];
  /** Number of waiting_on_customer kanban tasks of type manualScript — used when
   *  scripts[] is empty (no run results yet) to still show the panel header. */
  waitingManualScriptCount: number;
  onCompleted: () => void;
  onAllDismissed: () => void;
}

interface ScriptState {
  dismissed: boolean;
  confirmingDismiss: boolean;
}

export default function DiagnosticScriptPanel({ scripts, waitingManualScriptCount, onCompleted, onAllDismissed }: Props) {
  const [scriptStates, setScriptStates] = useState<Record<number, ScriptState>>(
    () => Object.fromEntries(scripts.map(s => [s.runResultId, { dismissed: false, confirmingDismiss: false }]))
  );

  const visible = scripts.filter(s => !scriptStates[s.runResultId]?.dismissed);
  const pending  = visible.filter(s => s.status === "awaiting_upload");
  const done     = visible.filter(s => s.status === "completed");

  // If we have no script run records at all, still show panel based on kanban count
  const totalVisible = visible.length > 0 ? visible.length : waitingManualScriptCount;
  const allDone = visible.length > 0 && pending.length === 0;

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

  return (
    <div className="flex-1 flex flex-col min-h-0 relative z-10">

      {/* ── Hero header ─────────────────────────────────────────────────────── */}
      <div className={`flex-shrink-0 px-8 py-5 flex items-center gap-4 ${
        allDone
          ? "bg-gradient-to-r from-green-500 to-emerald-500"
          : "bg-gradient-to-r from-amber-500 to-orange-500"
      }`}>
        {allDone ? (
          /* Completed state — checkmark pulse */
          <span className="relative flex-shrink-0">
            <span className="absolute inline-flex h-4 w-4 rounded-full bg-white opacity-40 animate-ping" />
            <span className="relative inline-flex rounded-full h-4 w-4 bg-white items-center justify-center">
              <svg className="w-2.5 h-2.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
          </span>
        ) : (
          /* Pending — attention pulse */
          <span className="relative flex-shrink-0">
            <span className="absolute inline-flex h-4 w-4 rounded-full bg-white opacity-50 animate-ping" />
            <span className="relative inline-flex rounded-full h-4 w-4 bg-white" />
          </span>
        )}

        <div className="flex-1 min-w-0">
          {allDone ? (
            <>
              <p className="text-white font-black text-base leading-tight">Results received — mark the task done</p>
              <p className="text-white/75 text-xs mt-0.5 leading-snug">
                The script output has been processed. Click <span className="font-bold text-white">"Mark as Done"</span> in the task list on the left to complete this step.
              </p>
            </>
          ) : (
            <>
              <p className="text-white font-black text-base leading-tight">Your diagnostic needs one more step</p>
              <p className="text-white/75 text-xs mt-0.5 leading-snug">
                {totalVisible === 1
                  ? "One script must run locally — some data can only be collected with direct access to your environment."
                  : `${totalVisible} scripts must run locally — some data can only be collected with direct access to your environment.`}
              </p>
            </>
          )}
        </div>

        {/* Count badge */}
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-white/20 border border-white/30 flex items-center justify-center">
          <span className="text-white font-black text-sm">{totalVisible}</span>
        </div>
      </div>

      {/* ── Context strip ───────────────────────────────────────────────────── */}
      {!allDone && (
        <div className="flex-shrink-0 px-8 py-3 bg-amber-50 border-b border-amber-200 flex items-start gap-2.5">
          <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
          </svg>
          <p className="text-xs text-amber-800 leading-relaxed">
            <span className="font-bold">Completing this unlocks your full M365 health score.</span>{" "}
            Shane uses this data to identify security gaps and optimisation opportunities your tenant can't surface automatically.
          </p>
        </div>
      )}

      {/* ── Scrollable card area ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">

        {/* No script run records yet — placeholder */}
        {visible.length === 0 && waitingManualScriptCount > 0 && (
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50/60 px-6 py-8 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 border border-amber-200 flex items-center justify-center">
              <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-[#0A2540]">Manual script required</p>
              <p className="text-xs text-[#0A2540]/60 mt-1 leading-relaxed max-w-xs">
                Shane has queued a script that needs to run locally. Check back shortly — a download link will appear here once it's ready.
              </p>
            </div>
          </div>
        )}

        {/* Completed scripts — show results received */}
        {done.map(script => (
          <div key={script.runResultId} className="rounded-xl border-2 border-green-200 bg-green-50/60 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-green-100">
              <div className="w-9 h-9 rounded-xl bg-green-100 border border-green-200 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-green-800 truncate">{script.scriptName}</p>
                <p className="text-xs text-green-600">
                  Results received{script.uploadedAt ? ` · ${new Date(script.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-green-100 text-green-700 border border-green-200 flex-shrink-0">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Uploaded
              </span>
            </div>
            <div className="px-5 py-3 flex items-center gap-2 bg-green-50">
              <svg className="w-3.5 h-3.5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <p className="text-xs text-green-700">
                Use the <span className="font-bold">"Mark as Done"</span> button on the task card to the left to complete this step.
              </p>
            </div>
          </div>
        ))}

        {/* Pending scripts — show full upload card */}
        {pending.map(script => {
          const st = scriptStates[script.runResultId];
          return (
            <div key={script.runResultId} className="space-y-3">
              <ManualScriptUploadCard
                script={script}
                projectId={script.projectId}
                onCompleted={onCompleted}
              />

              {/* Per-script dismiss */}
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
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-red-100 border border-red-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-3 h-3 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-red-800 leading-snug">Skip "{script.scriptName}"?</p>
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

      {/* ── Bottom strip ────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-[#0A2540]/8 px-8 py-3 bg-white/60 flex items-center gap-2" style={{ backdropFilter: "blur(8px)" }}>
        <svg className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
        <p className="text-[11px] text-[#0A2540]/50">
          {allDone
            ? "Your results have been processed by Shane's AI analyzer. Findings and recommendations will appear in your M365 health report."
            : "Your script runs locally — no credentials are sent to Shane or stored on our servers. Only the JSON output file is uploaded."}
        </p>
      </div>
    </div>
  );
}
