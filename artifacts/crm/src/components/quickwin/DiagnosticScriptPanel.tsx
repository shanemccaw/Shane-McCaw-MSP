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
    <div className="w-full space-y-2.5">

      {/* ── Label row ── */}
      <div className="flex items-center gap-2">
        <span className="relative flex-shrink-0">
          <span className={`absolute inline-flex h-2 w-2 rounded-full opacity-70 animate-ping ${allDone ? "bg-emerald-400" : "bg-amber-400"}`} />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${allDone ? "bg-emerald-400" : "bg-amber-400"}`} />
        </span>
        <p className={`text-[10px] font-bold uppercase tracking-widest ${allDone ? "text-emerald-600" : "text-amber-600"}`}>
          {allDone
            ? "Results received"
            : totalVisible === 1
              ? "1 script to run locally"
              : `${totalVisible} scripts to run locally`}
        </p>
      </div>

      {/* ── Downloadable tasks (before run results exist) ── */}
      {visible.length === 0 && waitingManualScriptCount > 0 && (
        downloadableTasks.length > 0 ? (
          <div className="space-y-2">
            {downloadableTasks.filter(t => !taskSkipStates[t.taskId]?.skipped).map(task => {
              const isDownloading = downloadingTaskIds.has(task.taskId);
              const skipState = taskSkipStates[task.taskId];
              return (
                <div key={task.taskId}>
                  {/* Script row */}
                  <div className="rounded-xl bg-white ring-1 ring-[#0078D4]/15 border-l-2 border-l-[#0078D4] px-3 py-3">
                    <div className="flex items-start gap-2.5 mb-2.5">
                      <div className="w-7 h-7 rounded-lg bg-[#0078D4]/8 flex items-center justify-center flex-shrink-0 mt-px">
                        <svg className="w-3.5 h-3.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-[#0A2540] truncate leading-tight">{task.scriptTitle}</p>
                        <p className="text-[11px] text-[#0A2540]/45 mt-0.5">Run locally, then upload the results.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => void downloadTask(task.taskId, task.scriptTitle)}
                      disabled={isDownloading}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0078D4] text-white text-[11px] font-bold hover:bg-[#006CBE] disabled:opacity-60 transition-colors"
                    >
                      {isDownloading ? (
                        <>
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Downloading…
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download Script (.ps1)
                        </>
                      )}
                    </button>
                  </div>

                  {/* Skip confirm / link */}
                  {!skipState?.confirming ? (
                    <div className="flex justify-end mt-1.5">
                      <button
                        onClick={() => startSkipTask(task.taskId)}
                        className="text-[11px] text-[#0A2540]/30 hover:text-[#0A2540]/55 font-medium transition-colors"
                      >
                        Skip this check ×
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 rounded-xl ring-1 ring-amber-200 bg-amber-50 px-3 py-2.5 space-y-2">
                      <p className="text-[11px] font-semibold text-amber-900">Skip &ldquo;{task.scriptTitle}&rdquo;?</p>
                      <p className="text-[11px] text-amber-800/70 leading-relaxed">
                        Some results won&rsquo;t appear in your health report without this script.
                      </p>
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => cancelSkipTask(task.taskId)} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#0A2540]/70 ring-1 ring-black/10 hover:bg-white transition-colors">
                          I&rsquo;ll run it
                        </button>
                        <button onClick={() => confirmSkipTask(task.taskId)} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors">
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
          /* Script being prepared */
          <div className="rounded-xl bg-white ring-1 ring-black/8 px-4 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4]/8 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-[#0078D4]/60 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-bold text-[#0A2540]">Script being prepared</p>
              <p className="text-[11px] text-[#0A2540]/45 mt-0.5 leading-snug">Download link appears here shortly.</p>
            </div>
          </div>
        )
      )}

      {/* ── Completed scripts ── */}
      {done.map(script => (
        <div key={script.runResultId} className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 border-l-2 border-l-emerald-400 px-3 py-2.5 flex items-center gap-2.5">
          <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-emerald-800 truncate">{script.scriptName}</p>
            <p className="text-[11px] text-emerald-600 mt-px">
              Uploaded{script.uploadedAt ? ` · ${new Date(script.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
              {" — "}mark task done in the left column.
            </p>
          </div>
        </div>
      ))}

      {/* ── Pending scripts awaiting upload (ManualScriptUploadCard) ── */}
      {pending.map(script => {
        const st = scriptStates[script.runResultId];
        return (
          <div key={script.runResultId} className="space-y-1.5">
            <ManualScriptUploadCard
              script={script}
              projectId={script.projectId}
              onCompleted={onCompleted}
              embedded
            />
            {!st?.confirmingDismiss ? (
              <div className="flex justify-end">
                <button
                  onClick={() => startDismiss(script.runResultId)}
                  className="text-[11px] text-[#0A2540]/30 hover:text-[#0A2540]/55 font-medium transition-colors"
                >
                  Skip this check ×
                </button>
              </div>
            ) : (
              <div className="rounded-xl ring-1 ring-red-200 bg-red-50 px-3 py-2.5 space-y-2">
                <p className="text-[11px] font-semibold text-red-800">Skip &ldquo;{script.scriptName}&rdquo;?</p>
                <p className="text-[11px] text-red-700/70 leading-relaxed">This data will be excluded from your health assessment.</p>
                <div className="flex items-center gap-2 justify-end">
                  <button onClick={() => cancelDismiss(script.runResultId)} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#0A2540]/70 ring-1 ring-black/10 hover:bg-white transition-colors">
                    Keep it
                  </button>
                  <button onClick={() => confirmDismiss(script.runResultId)} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors">
                    Yes, skip
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

    </div>
  );
}
