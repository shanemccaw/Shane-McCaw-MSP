import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ManualScriptUploadCard, type ManualScriptRecord } from "@/components/ManualScriptUploadCard";

interface ScriptEntry extends ManualScriptRecord {
  projectId: number;
}

interface DownloadableTask {
  taskId: number;
  scriptTitle: string;
}

interface Props {
  scripts: ScriptEntry[];
  waitingManualScriptCount: number;
  downloadableTasks: DownloadableTask[];
  onCompleted: () => void;
  onAllDismissed: () => void;
}

interface ScriptState {
  dismissed: boolean;
  confirmingDismiss: boolean;
}

interface TaskSkipState {
  skipped: boolean;
  confirming: boolean;
}

export default function DiagnosticScriptPanel({ scripts, waitingManualScriptCount, downloadableTasks, onCompleted, onAllDismissed }: Props) {
  const { fetchWithAuth } = useAuth();
  const [scriptStates, setScriptStates] = useState<Record<number, ScriptState>>(
    () => Object.fromEntries(scripts.map(s => [s.runResultId, { dismissed: false, confirmingDismiss: false }]))
  );
  const [taskSkipStates, setTaskSkipStates] = useState<Record<number, TaskSkipState>>({});
  const [downloadingTaskIds, setDownloadingTaskIds] = useState<Set<number>>(new Set());

  function startSkipTask(taskId: number) {
    setTaskSkipStates(prev => ({ ...prev, [taskId]: { skipped: false, confirming: true } }));
  }
  function cancelSkipTask(taskId: number) {
    setTaskSkipStates(prev => ({ ...prev, [taskId]: { skipped: false, confirming: false } }));
  }
  function confirmSkipTask(taskId: number) {
    // Mark the kanban task as completed so it moves off the board
    void fetchWithAuth(`/api/portal/kanban-tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column: "completed" }),
    });
    setTaskSkipStates(prev => {
      const next = { ...prev, [taskId]: { skipped: true, confirming: false } };
      const allSkipped = downloadableTasks.every(t => next[t.taskId]?.skipped);
      if (allSkipped) setTimeout(onAllDismissed, 120);
      return next;
    });
  }

  async function downloadTask(taskId: number, scriptTitle: string) {
    if (downloadingTaskIds.has(taskId)) return;
    setDownloadingTaskIds(prev => new Set(prev).add(taskId));
    try {
      const res = await fetchWithAuth(`/api/portal/tasks/${taskId}/download-script`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${scriptTitle.replace(/[^a-zA-Z0-9_-]/g, "_")}.ps1`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      // Trigger a refetch so the new run result appears as a ManualScriptUploadCard
      onCompleted();
    } catch {
      // keep button enabled so customer can retry
    } finally {
      setDownloadingTaskIds(prev => { const s = new Set(prev); s.delete(taskId); return s; });
    }
  }

  const visible = scripts.filter(s => !scriptStates[s.runResultId]?.dismissed);
  const pending = visible.filter(s => s.status === "awaiting_upload");
  const done    = visible.filter(s => s.status === "completed");
  const totalVisible = visible.length > 0 ? visible.length : waitingManualScriptCount;
  const allDone = visible.length > 0 && pending.length === 0;

  function startDismiss(id: number) {
    setScriptStates(prev => ({ ...prev, [id]: { ...prev[id]!, confirmingDismiss: true } }));
  }
  function cancelDismiss(id: number) {
    setScriptStates(prev => ({ ...prev, [id]: { ...prev[id]!, confirmingDismiss: false } }));
  }
  function confirmDismiss(id: number) {
    // Mark the linked kanban task as completed so it moves off the board
    const kanbanTaskId = scripts.find(s => s.runResultId === id)?.kanbanTaskId;
    if (kanbanTaskId) {
      void fetchWithAuth(`/api/portal/kanban-tasks/${kanbanTaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: "completed" }),
      });
    }
    setScriptStates(prev => {
      const next = { ...prev, [id]: { dismissed: true, confirmingDismiss: false } };
      if (scripts.every(s => next[s.runResultId]?.dismissed)) setTimeout(onAllDismissed, 120);
      return next;
    });
  }

  return (
    <div className="w-full flex items-center justify-center p-4 sm:p-8 relative z-10">
      <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 w-full max-w-md overflow-hidden">

        {/* ── Header — matches left panel's Deep Navy top bar ── */}
        <div className={`px-6 py-4 flex items-center gap-3 ${allDone ? "bg-[#0A2540]" : "bg-[#0A2540]"}`}>
          {/* Status dot */}
          <span className="relative flex-shrink-0">
            <span className={`absolute inline-flex h-2.5 w-2.5 rounded-full opacity-60 animate-ping ${allDone ? "bg-green-400" : "bg-amber-400"}`} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${allDone ? "bg-green-400" : "bg-amber-400"}`} />
          </span>

          <div className="flex-1 min-w-0">
            {allDone ? (
              <>
                <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-white/40">Step Complete</p>
                <p className="text-sm font-black text-white leading-tight">Results received</p>
              </>
            ) : (
              <>
                <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-white/40">Action Needed</p>
                <p className="text-sm font-black text-white leading-tight">
                  {totalVisible === 1 ? "One script to run locally" : `${totalVisible} scripts to run locally`}
                </p>
              </>
            )}
          </div>

          {/* Count badge */}
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
            <span className="text-white font-black text-xs">{totalVisible}</span>
          </div>
        </div>

        {/* ── Why this matters — subtle info row ── */}
        {!allDone && (
          <div className="px-6 py-2.5 bg-amber-50/80 border-b border-amber-100 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
            </svg>
            <p className="text-[11px] text-amber-800 leading-snug">
              <span className="font-bold">Completes your M365 health score.</span>{" "}
              Some data requires direct tenant access.
            </p>
          </div>
        )}

        {/* ── Card body ── */}
        <div className="px-6 py-5 space-y-5">

          {/* No run records yet — show download buttons if tasks are ready, else waiting state */}
          {visible.length === 0 && waitingManualScriptCount > 0 && (
            downloadableTasks.length > 0 ? (
              <div className="space-y-3">
                {downloadableTasks.filter(t => !taskSkipStates[t.taskId]?.skipped).map(task => {
                  const isDownloading = downloadingTaskIds.has(task.taskId);
                  const skipState = taskSkipStates[task.taskId];
                  return (
                    <div key={task.taskId} className="space-y-2">
                      <div className="rounded-xl ring-1 ring-[#0078D4]/20 bg-[#0078D4]/4 px-4 py-4">
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-8 h-8 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-[#0A2540] truncate">{task.scriptTitle}</p>
                            <p className="text-xs text-[#0A2540]/50 mt-0.5 leading-snug">
                              Run this script locally, then upload the results.
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => void downloadTask(task.taskId, task.scriptTitle)}
                          disabled={isDownloading}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0078D4] text-white text-xs font-bold hover:bg-[#006CBE] disabled:opacity-60 transition-colors"
                        >
                          {isDownloading ? (
                            <>
                              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                              </svg>
                              Downloading…
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Download Script (.ps1)
                            </>
                          )}
                        </button>
                      </div>

                      {/* Skip option */}
                      {!skipState?.confirming ? (
                        <div className="flex justify-end">
                          <button
                            onClick={() => startSkipTask(task.taskId)}
                            className="text-xs text-[#0A2540]/35 hover:text-[#0A2540]/60 font-medium transition-colors flex items-center gap-1"
                          >
                            Skip this check
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-xl ring-1 ring-amber-200 bg-amber-50 px-4 py-3 space-y-2.5">
                          <p className="text-xs font-semibold text-amber-900">Skip &ldquo;{task.scriptTitle}&rdquo;?</p>
                          <p className="text-xs text-amber-800/70 leading-relaxed">
                            I understand that <span className="font-semibold">some results won&rsquo;t appear</span> in my health report without running this script. Shane may follow up to collect it separately.
                          </p>
                          <div className="flex items-center gap-2 justify-end pt-0.5">
                            <button
                              onClick={() => cancelSkipTask(task.taskId)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0A2540]/70 ring-1 ring-black/10 hover:bg-white transition-colors"
                            >
                              I&rsquo;ll run it
                            </button>
                            <button
                              onClick={() => confirmSkipTask(task.taskId)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                            >
                              Yes, skip
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="w-11 h-11 rounded-2xl bg-[#0078D4]/8 flex items-center justify-center">
                  <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-[#0A2540]">Script being prepared</p>
                  <p className="text-xs text-[#0A2540]/50 mt-1 leading-relaxed max-w-[260px]">
                    Shane is configuring your diagnostic script. A download link will appear here shortly.
                  </p>
                </div>
              </div>
            )
          )}

          {/* Completed scripts */}
          {done.map(script => (
            <div key={script.runResultId} className="rounded-xl bg-green-50 ring-1 ring-green-200 px-4 py-3 flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-green-800 truncate">{script.scriptName}</p>
                <p className="text-xs text-green-600 mt-0.5">
                  Results uploaded{script.uploadedAt ? ` · ${new Date(script.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                </p>
                <p className="text-xs text-green-700/70 mt-1.5 leading-snug">
                  Click <span className="font-semibold">"Mark as Done"</span> on the task card to the left to complete this step.
                </p>
              </div>
            </div>
          ))}

          {/* Pending scripts — embedded ManualScriptUploadCard */}
          {pending.map(script => {
            const st = scriptStates[script.runResultId];
            return (
              <div key={script.runResultId} className="space-y-3">
                <ManualScriptUploadCard
                  script={script}
                  projectId={script.projectId}
                  onCompleted={onCompleted}
                  embedded
                />

                {/* Per-script dismiss */}
                {!st?.confirmingDismiss ? (
                  <div className="flex justify-end">
                    <button
                      onClick={() => startDismiss(script.runResultId)}
                      className="text-xs text-[#0A2540]/35 hover:text-[#0A2540]/60 font-medium transition-colors flex items-center gap-1"
                    >
                      Skip this check
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl ring-1 ring-red-200 bg-red-50 px-4 py-3 space-y-2.5">
                    <p className="text-xs font-semibold text-red-800">Skip &ldquo;{script.scriptName}&rdquo;?</p>
                    <p className="text-xs text-red-700/70 leading-relaxed">
                      This data will be <span className="font-semibold">excluded from your health assessment</span>. Shane may follow up to collect it separately.
                    </p>
                    <div className="flex items-center gap-2 justify-end pt-0.5">
                      <button
                        onClick={() => cancelDismiss(script.runResultId)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0A2540]/70 ring-1 ring-black/10 hover:bg-white transition-colors"
                      >
                        Keep it
                      </button>
                      <button
                        onClick={() => confirmDismiss(script.runResultId)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
                      >
                        Yes, skip
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Footer privacy note ── */}
        <div className="px-6 py-3 border-t border-black/5 bg-[#F7F9FC]/80 flex items-center gap-1.5">
          <svg className="w-3 h-3 text-[#0078D4]/60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <p className="text-[10px] text-[#0A2540]/40 leading-snug">
            {allDone
              ? "Results processed by Shane's AI analyzer. Findings appear in your M365 health report."
              : "Runs locally — no credentials are sent to Shane. Only the JSON output file is uploaded."}
          </p>
        </div>
      </div>
    </div>
  );
}
