import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProgressEvent {
  type: "progress";
  current: number;
  total: number;
  stepTitle: string;
  taskTitle: string;
}

interface TaskDoneEvent {
  type: "task_done";
  current: number;
  total: number;
  stepTitle: string;
  taskTitle: string;
  setsCreated: number;
  failed: boolean;
}

interface DoneEvent {
  type: "done";
  processed: number;
  setsCreated: number;
  failed: number;
}

interface ErrorEvent {
  type: "error";
  message: string;
}

type SSEEvent = ProgressEvent | TaskDoneEvent | DoneEvent | ErrorEvent;

interface LogEntry {
  stepTitle: string;
  taskTitle: string;
  setsCreated: number;
  failed: boolean;
}

interface DialogState {
  total: number;
  current: number;
  currentStepTitle: string;
  currentTaskTitle: string;
  log: LogEntry[];
  done: boolean;
  summary: { processed: number; setsCreated: number; failed: number } | null;
  error: string | null;
}

const INITIAL_STATE: DialogState = {
  total: 0,
  current: 0,
  currentStepTitle: "",
  currentTaskTitle: "",
  log: [],
  done: false,
  summary: null,
  error: null,
};

// ─── Component ────────────────────────────────────────────────────────────────

interface GenerateAssetsDialogProps {
  templateId: number;
  open: boolean;
  onClose: () => void;
}

export function GenerateAssetsDialog({ templateId, open, onClose }: GenerateAssetsDialogProps) {
  const { fetchWithAuth } = useAuth();
  const [state, setState] = useState<DialogState>(INITIAL_STATE);
  const logRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  useEffect(() => {
    if (!open) return;

    setState(INITIAL_STATE);

    let cancelled = false;

    async function run() {
      try {
        const res = await fetchWithAuth(
          `/api/admin/workflow-templates/${templateId}/generate-asset-sets`,
          {
            method: "POST",
            headers: { Accept: "text/event-stream" },
          }
        );

        if (!res.ok || !res.body) {
          setState(s => ({ ...s, done: true, error: "Server returned an error. Please try again." }));
          return;
        }

        const reader = res.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let evt: SSEEvent;
            try {
              evt = JSON.parse(line.slice(6)) as SSEEvent;
            } catch {
              continue;
            }

            if (evt.type === "progress") {
              setState(s => ({
                ...s,
                total: evt.total,
                current: evt.current,
                currentStepTitle: evt.stepTitle,
                currentTaskTitle: evt.taskTitle,
              }));
            } else if (evt.type === "task_done") {
              setState(s => ({
                ...s,
                total: evt.total,
                current: evt.current,
                log: [
                  ...s.log,
                  {
                    stepTitle: evt.stepTitle,
                    taskTitle: evt.taskTitle,
                    setsCreated: evt.setsCreated,
                    failed: evt.failed,
                  },
                ],
              }));
            } else if (evt.type === "done") {
              setState(s => ({
                ...s,
                done: true,
                summary: { processed: evt.processed, setsCreated: evt.setsCreated, failed: evt.failed },
              }));
            } else if (evt.type === "error") {
              setState(s => ({ ...s, done: true, error: evt.message }));
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setState(s => ({ ...s, done: true, error: "Network error — generation may be incomplete." }));
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
      if (readerRef.current) {
        void readerRef.current.cancel();
        readerRef.current = null;
      }
    };
  }, [open, templateId, fetchWithAuth]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [state.log]);

  const progressPct = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next && state.done) onClose();
      }}
    >
      <DialogContent
        className="max-w-lg w-full"
        closeDisabled={!state.done}
        onPointerDownOutside={e => { if (!state.done) e.preventDefault(); }}
        onEscapeKeyDown={e => { if (!state.done) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#0A2540]">
            <svg className="w-4 h-4 text-purple-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Asset Sets
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* ── Progress bar ── */}
          {!state.done && state.total > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Processing tasks…</span>
                <span className="font-medium tabular-nums">{state.current} of {state.total}</span>
              </div>
              <Progress value={progressPct} className="h-2" />
            </div>
          )}

          {/* ── Current task ── */}
          {!state.done && state.total > 0 && (state.currentStepTitle || state.currentTaskTitle) && (
            <div className="rounded-lg bg-purple-50 border border-purple-100 px-3 py-2.5 space-y-0.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-purple-400">Now generating</p>
              {state.currentStepTitle && (
                <p className="text-xs text-purple-600 font-medium leading-snug">{state.currentStepTitle}</p>
              )}
              {state.currentTaskTitle && (
                <p className="text-sm text-purple-900 font-semibold leading-snug">{state.currentTaskTitle}</p>
              )}
            </div>
          )}

          {/* ── Waiting to start ── */}
          {!state.done && state.total === 0 && !state.error && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <svg className="w-4 h-4 animate-spin text-purple-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Starting generation…
            </div>
          )}

          {/* ── Log of completed tasks ── */}
          {state.log.length > 0 && (
            <div
              ref={logRef}
              className="max-h-48 overflow-y-auto space-y-1 rounded-lg border border-gray-100 bg-gray-50 p-2"
            >
              {state.log.map((entry, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${
                    entry.failed ? "bg-red-50 text-red-700" : "bg-white text-gray-700 border border-gray-100"
                  }`}
                >
                  {entry.failed ? (
                    <svg className="w-3 h-3 flex-shrink-0 mt-0.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 flex-shrink-0 mt-0.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="font-medium truncate block">{entry.taskTitle}</span>
                    <span className="text-gray-400">{entry.stepTitle}</span>
                    {!entry.failed && entry.setsCreated > 0 && (
                      <span className="ml-1 text-green-600">· {entry.setsCreated} set{entry.setsCreated === 1 ? "" : "s"} created</span>
                    )}
                    {entry.failed && <span className="ml-1">— AI generation failed</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Summary ── */}
          {state.done && state.summary && (
            <div className={`rounded-lg border px-3 py-3 space-y-1 ${
              (state.summary.failed ?? 0) > 0
                ? "bg-amber-50 border-amber-200"
                : state.summary.processed === 0
                  ? "bg-blue-50 border-blue-100"
                  : "bg-green-50 border-green-200"
            }`}>
              <p className={`text-sm font-semibold ${
                (state.summary.failed ?? 0) > 0
                  ? "text-amber-800"
                  : state.summary.processed === 0
                    ? "text-blue-700"
                    : "text-green-800"
              }`}>
                {state.summary.processed === 0
                  ? "Nothing to generate"
                  : (state.summary.failed ?? 0) > 0
                    ? "Completed with some errors"
                    : "Generation complete"}
              </p>
              {state.summary.processed === 0 ? (
                <p className="text-xs text-blue-600">All tasks already have asset sets linked.</p>
              ) : (
                <p className="text-xs text-gray-600">
                  {state.summary.processed} task{state.summary.processed === 1 ? "" : "s"} processed
                  {" · "}{state.summary.setsCreated} asset set{state.summary.setsCreated === 1 ? "" : "s"} created
                  {(state.summary.failed ?? 0) > 0 && (
                    <span className="text-amber-600"> · {state.summary.failed} failed</span>
                  )}
                </p>
              )}
            </div>
          )}

          {/* ── Error ── */}
          {state.done && state.error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3">
              <p className="text-sm font-semibold text-red-700">Generation failed</p>
              <p className="text-xs text-red-600 mt-0.5">{state.error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            disabled={!state.done}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {state.done ? "Close" : "Running…"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
