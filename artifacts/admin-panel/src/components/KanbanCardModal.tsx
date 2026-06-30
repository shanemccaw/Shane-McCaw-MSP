import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TypedModalSection,
  getTypedStatusBanner,
  TASK_TYPE_CONFIG,
  type TaskType,
} from "@/components/kanban/TypedCardContent";
import ChecklistClosureDialog from "@/components/kanban/ChecklistClosureDialog";
import type { ClosureField } from "@/components/kanban/ChecklistClosureForm";
import RunLibraryScriptDialog from "@/components/RunLibraryScriptDialog";
import RunScriptConfirmDialog from "@/components/RunScriptConfirmDialog";
import { isActiveForTask, subscribeToChanges, resumePollForTask } from "@/lib/scriptPoller";
import { useToast } from "@/hooks/use-toast";

export interface KanbanCardModalTask {
  id: number;
  title: string;
  description?: string | null;
  column: string;
  groupName?: string | null;
  assignedTo?: string | null;
  dueDate?: string | null;
  workflowStepId?: number | null;
  waitingReason?: string | null;
  completionStatus?: string | null;
  completionNotes?: string | null;
  priority?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  taskType?: string | null;
  taskMetadata?: Record<string, unknown> | null;
}

interface Props {
  task: KanbanCardModalTask | null;
  stepTitle?: string | null;
  open: boolean;
  onClose: () => void;
  mode?: "client" | "admin";
  fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
  onUpdate?: (updated: KanbanCardModalTask) => void;
  clientId?: number | null;
  clientName?: string | null;
  boardTasks?: KanbanCardModalTask[];
  onSiblingUpdate?: (updated: KanbanCardModalTask) => void;
}

const COLUMN_CONFIG: Record<string, { label: string; cls: string }> = {
  backlog:              { label: "Backlog",              cls: "bg-[#30363D] text-[#7D8590] border border-[#30363D]" },
  in_progress:         { label: "In Progress",          cls: "bg-blue-500/15 text-blue-400 border border-blue-500/20" },
  waiting_on_customer: { label: "Waiting on Customer",  cls: "bg-amber-500/15 text-amber-400 border border-amber-500/20" },
  completed:           { label: "Completed",            cls: "bg-green-500/15 text-green-400 border border-green-500/20" },
};

const PRIORITY_CONFIG: Record<string, { label: string; cls: string; dot: string }> = {
  critical: { label: "Critical", cls: "bg-red-500/15 text-red-400 border border-red-500/20",      dot: "bg-red-500" },
  high:     { label: "High",     cls: "bg-orange-500/15 text-orange-400 border border-orange-500/20", dot: "bg-orange-500" },
  medium:   { label: "Medium",   cls: "bg-blue-500/15 text-blue-400 border border-blue-500/20",   dot: "bg-blue-500" },
  low:      { label: "Low",      cls: "bg-[#30363D] text-[#7D8590] border border-[#30363D]",   dot: "bg-gray-400" },
};

interface EditForm {
  title: string;
  description: string;
  priority: string;
  assignedTo: string;
  dueDate: string;
}

interface ChecklistItem {
  id: string;
  label: string;
}

interface StoredClosureData {
  schema: ClosureField[];
  answers: Record<string, string | string[]>;
  capturedAt: string;
}

function ChecklistClosureDataView({ data }: { data: StoredClosureData }) {
  return (
    <div className="mt-2 bg-[#1C2128] border border-[#0078D4]/20 rounded-lg p-3 space-y-2.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-[#0078D4] mb-1.5">
        Captured details · {new Date(data.capturedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
      </p>
      {data.schema.map((field) => {
        const answer = data.answers[field.id];
        if (!answer || (Array.isArray(answer) && answer.length === 0)) return null;
        return (
          <div key={field.id}>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">{field.label}</p>
            {Array.isArray(answer) ? (
              <ul className="space-y-0.5">
                {answer.map((row, i) => (
                  <li key={i} className="text-xs text-[#E6EDF3] flex items-start gap-1">
                    <span className="text-[#0078D4] flex-shrink-0 mt-0.5">·</span>
                    {field.type === "url" ? (
                      <a href={row} target="_blank" rel="noreferrer" className="underline text-[#0078D4] break-all">{row}</a>
                    ) : (
                      <span>{row}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : field.type === "url" ? (
              <a href={answer} target="_blank" rel="noreferrer" className="text-xs text-[#0078D4] underline break-all">{answer}</a>
            ) : (
              <p className="text-xs text-[#E6EDF3] whitespace-pre-wrap leading-snug">{answer}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface LastRunResult {
  savedAt: string;
  jobRef: string;
  scriptTitle?: string;
  findings: string[];
  recommendations: string[];
  scoreImpact?: Record<string, number>;
}

interface AutoSavedAiAnalysis {
  summary?: string;
  risks?: string[];
  recommendations?: string[];
  nextSteps?: string[];
}

function AutoSavedScriptResultsSection({
  scriptOutput,
  aiAnalysis,
  completedAt,
  failedAt,
  lastJobStatus,
}: {
  scriptOutput?: string;
  aiAnalysis?: AutoSavedAiAnalysis;
  completedAt?: string;
  failedAt?: string;
  lastJobStatus?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  const timestamp = completedAt ?? failedAt;
  const isFailure = !!failedAt && !completedAt;
  const statusLabel = lastJobStatus ?? (isFailure ? "Failed" : "Completed");
  const formattedDate = timestamp
    ? new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  const hasAi = !!(aiAnalysis?.summary || (aiAnalysis?.risks?.length ?? 0) > 0 || (aiAnalysis?.recommendations?.length ?? 0) > 0);
  const hasOutput = !!scriptOutput?.trim();

  if (!hasAi && !hasOutput) return null;

  return (
    <div className={`border rounded-lg overflow-hidden ${isFailure ? "border-red-500/20" : "border-emerald-500/20"}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${isFailure ? "bg-red-500/8 hover:bg-red-500/12" : "bg-emerald-500/8 hover:bg-emerald-500/12"}`}
      >
        <div className="flex items-center gap-2">
          <svg className={`w-3.5 h-3.5 flex-shrink-0 ${isFailure ? "text-red-400" : "text-emerald-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
          </svg>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${isFailure ? "text-red-400" : "text-emerald-400"}`}>
            Auto-Run Results · {statusLabel}
          </p>
          {formattedDate && <span className="text-[9px] text-[#484F58]">{formattedDate}</span>}
        </div>
        <span className="material-symbols-outlined text-muted-foreground flex-shrink-0" style={{ fontSize: "16px" }}>
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div className="px-4 py-3 border-t border-border/60 space-y-3 bg-[#0D1117]/40">
          {aiAnalysis?.summary && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Summary</p>
              <p className="text-xs text-[#C9D1D9] leading-relaxed">{aiAnalysis.summary}</p>
            </div>
          )}

          {(aiAnalysis?.risks?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-red-400 mb-1.5">Risks</p>
              <ul className="space-y-1">
                {aiAnalysis!.risks!.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#C9D1D9]">
                    <span className="text-red-400 mt-0.5 flex-shrink-0">⚠</span>
                    <span className="leading-relaxed">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(aiAnalysis?.recommendations?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-1.5">Recommendations</p>
              <ol className="space-y-1">
                {aiAnalysis!.recommendations!.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#C9D1D9]">
                    <span className="text-emerald-400 mt-0.5 flex-shrink-0 font-semibold">{i + 1}.</span>
                    <span className="leading-relaxed">{rec}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {(aiAnalysis?.nextSteps?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-1.5">Next Steps</p>
              <ol className="space-y-1">
                {aiAnalysis!.nextSteps!.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#C9D1D9]">
                    <span className="text-blue-400 mt-0.5 flex-shrink-0">→</span>
                    <span className="leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {hasOutput && (
            <div>
              <button
                onClick={() => setShowOutput(o => !o)}
                className="text-[10px] font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors flex items-center gap-1"
              >
                <svg className={`w-3 h-3 transition-transform ${showOutput ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                {showOutput ? "Hide" : "Show"} raw output
              </button>
              {showOutput && (
                <pre className="mt-2 text-[10px] text-[#8B949E] bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2.5 whitespace-pre-wrap font-mono leading-relaxed max-h-52 overflow-y-auto">
                  {scriptOutput}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LastRunResultsSection({ result }: { result: LastRunResult }) {
  const [open, setOpen] = useState(false);
  const [showAllFindings, setShowAllFindings] = useState(false);
  const [showAllRecs, setShowAllRecs] = useState(false);

  const visibleFindings = showAllFindings ? result.findings : result.findings.slice(0, 5);
  const visibleRecs = showAllRecs ? result.recommendations : result.recommendations.slice(0, 5);
  const hasFindings = result.findings.length > 0;
  const hasRecs = result.recommendations.length > 0;

  const savedDate = new Date(result.savedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="border border-[#0078D4]/20 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left bg-[#0078D4]/8 hover:bg-[#0078D4]/12 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#0078D4]">Last Run Results</p>
          <span className="text-[9px] text-[#484F58]">{savedDate}</span>
        </div>
        <span className="material-symbols-outlined text-[#0078D4] flex-shrink-0" style={{ fontSize: "16px" }}>
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div className="px-4 py-3 border-t border-[#0078D4]/15 space-y-3 bg-[#0D1117]/40">
          {!hasFindings && !hasRecs && (
            <p className="text-xs text-[#484F58] italic">No findings or recommendations were recorded.</p>
          )}

          {hasFindings && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-2">Findings</p>
              <ul className="space-y-1.5">
                {visibleFindings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#C9D1D9]">
                    <span className="text-blue-400 mt-0.5 flex-shrink-0">•</span>
                    <span className="leading-relaxed">{f}</span>
                  </li>
                ))}
              </ul>
              {result.findings.length > 5 && (
                <button
                  onClick={() => setShowAllFindings(v => !v)}
                  className="mt-1.5 text-[10px] font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors"
                >
                  {showAllFindings ? "Show less" : `Show ${result.findings.length - 5} more`}
                </button>
              )}
            </div>
          )}

          {hasRecs && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-2">Recommendations</p>
              <ol className="space-y-1.5">
                {visibleRecs.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#C9D1D9]">
                    <span className="text-green-400 mt-0.5 flex-shrink-0 font-semibold">{i + 1}.</span>
                    <span className="leading-relaxed">{r}</span>
                  </li>
                ))}
              </ol>
              {result.recommendations.length > 5 && (
                <button
                  onClick={() => setShowAllRecs(v => !v)}
                  className="mt-1.5 text-[10px] font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors"
                >
                  {showAllRecs ? "Show less" : `Show ${result.recommendations.length - 5} more`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EngineerDetailSection({
  task,
  fetchWithAuth,
  onMetadataUpdate,
}: {
  task: KanbanCardModalTask;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  onMetadataUpdate: (meta: Record<string, unknown>) => void;
}) {
  const meta = (task.taskMetadata ?? {}) as Record<string, unknown>;
  const instructions = (meta.instructions ?? []) as string[];
  const checklist = (meta.checklist ?? []) as ChecklistItem[];
  const artifactsProduced = (meta.artifactsProduced ?? []) as string[];
  const clientDeliverables = (meta.clientDeliverables ?? []) as string[];
  const checklistState = (meta.checklistState ?? {}) as Record<string, boolean>;
  const checklistItemData = (meta.checklistItemData ?? {}) as Record<string, StoredClosureData>;
  const uploadedArtifacts = (meta.uploadedArtifacts ?? []) as string[];

  const [toggling, setToggling] = useState<string | null>(null);
  const [uploadedLocal, setUploadedLocal] = useState<string[]>(uploadedArtifacts);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [closureDialog, setClosureDialog] = useState<{ itemId: string; itemLabel: string } | null>(null);
  const [expandedCaptured, setExpandedCaptured] = useState<Record<string, boolean>>({});

  const checkedCount = checklist.filter(item => checklistState[item.id]).length;

  const directUncheck = async (itemId: string) => {
    setToggling(itemId);
    try {
      const res = await fetchWithAuth(`/api/admin/kanban-tasks/${task.id}/checklist/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked: false }),
      });
      if (res.ok) {
        const data = await res.json() as { taskMetadata: Record<string, unknown> };
        onMetadataUpdate(data.taskMetadata);
      }
    } finally {
      setToggling(null);
    }
  };

  const handleCheckboxChange = (itemId: string, itemLabel: string, checked: boolean) => {
    if (checked) {
      setClosureDialog({ itemId, itemLabel });
    } else {
      void directUncheck(itemId);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // TODO: Replace this stub with a real SharePoint write call once the
    // SharePoint site ↔ project association task is complete. For now, we
    // store the filename locally in uploadedArtifacts inside taskMetadata.
    const newUploaded = [...uploadedLocal, file.name];
    setUploadedLocal(newUploaded);
    const updatedMeta = { ...meta, uploadedArtifacts: newUploaded };
    void fetchWithAuth(`/api/admin/kanban-tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskMetadata: updatedMeta }),
    }).then(async res => {
      if (res.ok) {
        const updated = await res.json() as { taskMetadata: Record<string, unknown> };
        onMetadataUpdate(updated.taskMetadata);
      }
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const hasAny = instructions.length > 0 || checklist.length > 0 || artifactsProduced.length > 0 || clientDeliverables.length > 0;

  if (!hasAny && uploadedLocal.length === 0) {
    return (
      <div className="bg-[#1C2128] border border-border rounded-lg p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Engineer Detail</p>
        <p className="text-xs text-muted-foreground italic">No engineer detail has been added to this task's template yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-[#1C2128] border border-border rounded-lg p-4 space-y-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#E6EDF3]">Engineer Detail</p>

      {/* Instructions */}
      {instructions.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Instructions</p>
          <ol className="space-y-1.5">
            {instructions.map((inst, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-[#0078D4]/10 text-[#0078D4] text-[9px] font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="text-xs text-[#E6EDF3] leading-relaxed">{inst}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Checklist */}
      {checklist.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Checklist</p>
            <span className="text-[9px] font-semibold text-muted-foreground bg-[#1C2128] border border-border rounded-full px-2 py-0.5">
              {checkedCount}/{checklist.length} done
            </span>
          </div>
          <div className="space-y-1.5">
            {checklist.map(item => {
              const isChecked = !!checklistState[item.id];
              const isToggling = toggling === item.id;
              const capturedData = checklistItemData[item.id];
              const isCapturedExpanded = !!expandedCaptured[item.id];
              return (
                <div key={item.id}>
                  <div
                    className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${isChecked ? "bg-green-500/10" : "bg-[#161B22] hover:bg-[#1C2128]"} border ${isChecked ? "border-green-500/20" : "border-border"}`}
                  >
                    <button
                      type="button"
                      disabled={isToggling}
                      onClick={() => handleCheckboxChange(item.id, item.label, !isChecked)}
                      className="relative flex-shrink-0 focus:outline-none"
                      aria-label={isChecked ? "Uncheck" : "Check"}
                    >
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${isChecked ? "bg-green-500 border-green-500" : "border-[#30363D] bg-[#1C2128] hover:border-[#0078D4]"}`}>
                        {isToggling ? (
                          <div className="w-2 h-2 border border-white/60 border-t-white rounded-full animate-spin" />
                        ) : isChecked ? (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : null}
                      </div>
                    </button>
                    <span className={`text-xs leading-snug flex-1 transition-colors ${isChecked ? "line-through text-muted-foreground" : "text-[#E6EDF3]"}`}>
                      {item.label}
                    </span>
                    {capturedData && (
                      <button
                        type="button"
                        onClick={() => setExpandedCaptured(e => ({ ...e, [item.id]: !e[item.id] }))}
                        className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9px] font-semibold text-[#0078D4] bg-[#0078D4]/10 border border-[#0078D4]/20 hover:bg-[#0078D4]/20 rounded px-1.5 py-0.5 transition-colors"
                        title="View captured details"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        Details captured
                      </button>
                    )}
                  </div>
                  {capturedData && isCapturedExpanded && (
                    <ChecklistClosureDataView data={capturedData} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Artifacts Produced */}
      {(artifactsProduced.length > 0 || uploadedLocal.length > 0) && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Artifacts Produced</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {artifactsProduced.map((artifact, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {artifact}
              </span>
            ))}
          </div>
          {/* Uploaded files */}
          {uploadedLocal.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {uploadedLocal.map((fname, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  {fname}
                </span>
              ))}
            </div>
          )}
          {/* Upload button stub */}
          <input ref={fileInputRef} type="file" className="sr-only" onChange={handleFileUpload} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] border border-[#0078D4]/30 hover:border-[#0078D4] hover:bg-[#0078D4]/10 rounded-lg px-3 py-1.5 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Upload artifact
          </button>
        </div>
      )}

      {/* Client Deliverables */}
      {clientDeliverables.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Client Deliverables</p>
          <div className="flex flex-wrap gap-1.5">
            {clientDeliverables.map((deliverable, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                {deliverable}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* AI Closure Dialog */}
      {closureDialog && (
        <ChecklistClosureDialog
          open={!!closureDialog}
          taskId={task.id}
          taskTitle={task.title}
          taskDescription={task.description}
          itemId={closureDialog.itemId}
          itemLabel={closureDialog.itemLabel}
          fetchWithAuth={fetchWithAuth}
          onSubmitted={(updatedMeta) => {
            setClosureDialog(null);
            onMetadataUpdate(updatedMeta);
          }}
          onCancel={() => setClosureDialog(null)}
        />
      )}
    </div>
  );
}

export function KanbanCardModal(props: Props) {
  return <GenericKanbanCardModal {...props} />;
}

function GenericKanbanCardModal({ task, stepTitle, open, onClose, mode = "client", fetchWithAuth, onUpdate, clientId, clientName, boardTasks, onSiblingUpdate }: Props) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditForm>({ title: "", description: "", priority: "", assignedTo: "", dueDate: "" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [localTask, setLocalTask] = useState<KanbanCardModalTask | null>(null);
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [confirmRunOpen, setConfirmRunOpen] = useState(false);
  const [movingToInProgress, setMovingToInProgress] = useState(false);
  const [scriptRunning, setScriptRunning] = useState(false);
  const [confirmedAppRegId, setConfirmedAppRegId] = useState<number | null>(null);

  useEffect(() => {
    if (!task) return;
    const unsubscribe = subscribeToChanges(() => {
      setScriptRunning(isActiveForTask(task.id));
    });
    return unsubscribe;
  }, [task?.id]);

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title ?? "",
        description: task.description ?? "",
        priority: task.priority ?? "",
        assignedTo: task.assignedTo ?? "",
        dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
      });
      setLocalTask(task);
      const alreadyActive = isActiveForTask(task.id);
      setScriptRunning(alreadyActive);
      if (!alreadyActive && fetchWithAuth) {
        const meta = (task.taskMetadata ?? {}) as Record<string, unknown>;
        const runningJobRef = meta.runningJobRef as string | null | undefined;
        if (runningJobRef) {
          resumePollForTask(task.id, runningJobRef, fetchWithAuth);
        }
      }
    }
    setEditing(false);
    setSaveError(null);
  }, [task]);

  if (!task || !localTask) return null;

  const colCfg = COLUMN_CONFIG[localTask.column] ?? { label: localTask.column, cls: "bg-[#30363D] text-[#7D8590] border border-[#30363D]" };
  const priorityCfg = localTask.priority ? PRIORITY_CONFIG[localTask.priority] : null;

  const handleSave = async () => {
    if (!fetchWithAuth || !onUpdate) return;
    if (!form.title.trim()) { setSaveError("Title is required"); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority || null,
        assignedTo: form.assignedTo.trim() || null,
        dueDate: form.dueDate || null,
      };
      const res = await fetchWithAuth(`/api/admin/kanban-tasks/${localTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setSaveError(d.error ?? "Failed to save");
        return;
      }
      const updated = await res.json() as KanbanCardModalTask;
      const merged = { ...localTask, ...updated };
      setLocalTask(merged);
      onUpdate(merged);
      setEditing(false);
    } catch {
      setSaveError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  const handleMetadataUpdate = (meta: Record<string, unknown>) => {
    const merged = { ...localTask, taskMetadata: meta };
    setLocalTask(merged);
    onUpdate?.(merged);
  };

  const handleConfirmRun = async () => {
    if (isActiveForTask(localTask.id)) return;
    setConfirmRunOpen(false);

    // Pre-flight: clientId must be set and the client must have an App Registration
    if (clientId == null) {
      toast({
        title: "No client identified",
        description: "This card has no linked client. Assign a client in CRM before running a script.",
        variant: "destructive",
      });
      return;
    }
    if (fetchWithAuth) {
      try {
        const r = await fetchWithAuth("/api/admin/clients/with-azure-credentials");
        if (r.ok) {
          const list = await r.json() as Array<{ id: number; appRegistration: { id: number } | null }>;
          const entry = list.find(c => c.id === clientId);
          if (!entry || !entry.appRegistration) {
            toast({
              title: "No App Registration",
              description: "This client has no App Registration. Add one in CRM before running a script.",
              variant: "destructive",
            });
            return;
          }
          setConfirmedAppRegId(entry.appRegistration.id);
        }
      } catch { /* non-fatal — proceed, run dialog will surface the error */ }
    }

    setScriptRunning(true);

    // Move triggering card to In Progress immediately
    if (fetchWithAuth && localTask && localTask.column !== "in_progress") {
      setMovingToInProgress(true);
      try {
        const res = await fetchWithAuth(`/api/admin/kanban-tasks/${localTask.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ column: "in_progress" }),
        });
        if (res.ok) {
          const updated = await res.json() as KanbanCardModalTask;
          const merged = { ...localTask, ...updated };
          setLocalTask(merged);
          onUpdate?.(merged);
        }
      } catch { /* silent — script will still run */ }
      setMovingToInProgress(false);
    }

    // Optimistically move sibling cards (same azureRunbookName) to In Progress
    if (onSiblingUpdate && boardTasks && linkedRunbook?.azureRunbookName) {
      for (const bt of boardTasks) {
        if (bt.id === localTask.id) continue;
        const btMeta = (bt.taskMetadata ?? {}) as Record<string, unknown>;
        const btRunbook = btMeta.linkedRunbook as { azureRunbookName?: string } | null | undefined;
        if (btRunbook?.azureRunbookName === linkedRunbook.azureRunbookName && bt.column !== "in_progress") {
          onSiblingUpdate({ ...bt, column: "in_progress" });
        }
      }
    }

    setRunDialogOpen(true);
  };

  const handleRunComplete = (status: "completed" | "failed", title: string) => {
    setScriptRunning(false);
    toast({
      title: status === "completed" ? `Script completed: ${title}` : `Script failed: ${title}`,
      description: status === "completed"
        ? "The runbook finished successfully. The card has been moved to Done."
        : "The runbook encountered an error. The card remains In Progress.",
      variant: status === "failed" ? "destructive" : "default",
    });
  };

  const inputCls = "w-full border border-border rounded-lg px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 bg-[#1C2128]";
  const labelCls = "block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1";

  const meta = (localTask.taskMetadata ?? {}) as Record<string, unknown>;
  const checklist = (meta.checklist ?? []) as Array<{ id: string; label: string }>;
  const checklistState = (meta.checklistState ?? {}) as Record<string, boolean>;
  const checkedCount = checklist.filter(item => checklistState[item.id]).length;
  const banner = getTypedStatusBanner(localTask.taskType, localTask.taskMetadata);
  const typeCfg = localTask.taskType ? TASK_TYPE_CONFIG[localTask.taskType as TaskType] : null;
  const linkedRunbook = meta.linkedRunbook as { scriptId: string; azureRunbookName: string; scriptTitle: string } | null | undefined;

  return (
    <>
    <Dialog open={open} onOpenChange={o => { if (!o) { setEditing(false); onClose(); } }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-2">
            <div className="flex-1 min-w-0">
              {localTask.groupName && (
                <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 mb-2">
                  {localTask.groupName}
                </span>
              )}
              {editing ? (
                <input
                  className={inputCls + " text-base font-bold"}
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Task title"
                  autoFocus
                />
              ) : (
                <DialogTitle className="text-base font-bold text-[#E6EDF3] leading-snug">
                  {localTask.title}
                </DialogTitle>
              )}
            </div>

            {/* Run Script button (when linked runbook present) */}
            {!editing && linkedRunbook?.azureRunbookName && (
              <button
                onClick={() => { if (!scriptRunning) setConfirmRunOpen(true); }}
                disabled={movingToInProgress || scriptRunning}
                className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 hover:border-emerald-400 rounded-lg px-2.5 py-1.5 transition-colors mt-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {movingToInProgress || scriptRunning ? (
                  <div className="w-3.5 h-3.5 border border-emerald-400/40 border-t-emerald-400 rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                )}
                {scriptRunning ? "Running in background…" : "Run Script"}
              </button>
            )}

            {/* Edit / Cancel toggle (admin only) */}
            {mode === "admin" && fetchWithAuth && onUpdate && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 border border-[#0078D4]/30 hover:border-[#0078D4] rounded-lg px-2.5 py-1.5 transition-colors mt-0.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit
              </button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-1">

          {/* ── EDIT MODE ─────────────────────────────────────────────────── */}
          {editing ? (
            <>
              <div>
                <label className={labelCls}>Description</label>
                <textarea
                  className={inputCls + " resize-none"}
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description…"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Priority</label>
                  <select
                    className={inputCls}
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  >
                    <option value="">No priority</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Due Date</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.dueDate}
                    onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Assigned To</label>
                <input
                  className={inputCls}
                  value={form.assignedTo}
                  onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
                  placeholder="Name or email"
                />
              </div>

              {saveError && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{saveError}</p>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="flex items-center gap-1.5 bg-[#0A2540] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0A2540]/90 disabled:opacity-50 transition-colors"
                >
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  {saving ? "Saving…" : "Save changes"}
                </button>
                <button
                  onClick={() => { setEditing(false); setSaveError(null); }}
                  disabled={saving}
                  className="text-sm font-semibold text-muted-foreground hover:text-[#E6EDF3] px-3 py-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : localTask.taskType ? (
            /* ── TYPED VIEW MODE ──────────────────────────────────────────── */
            <>
              {banner && (
                <div className={`flex items-start gap-2.5 rounded-lg px-4 py-3 ${
                  banner.variant === "error"   ? "bg-red-500/10 border border-red-500/20 text-red-400" :
                  banner.variant === "warning" ? "bg-amber-500/10 border border-amber-500/20 text-amber-400" :
                                                 "bg-green-500/10 border border-green-500/20 text-green-400"
                }`}>
                  <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ fontSize: "18px" }}>
                    {banner.variant === "error" ? "error" : banner.variant === "warning" ? "warning" : "check_circle"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-snug">{banner.headline}</p>
                    {banner.detail && <p className="text-xs mt-0.5 opacity-80 leading-relaxed line-clamp-2">{banner.detail}</p>}
                  </div>
                </div>
              )}

              {typeCfg && <div className={`h-0.5 w-full rounded-full opacity-60 ${typeCfg.bar}`} />}

              <TypedModalSection
                taskType={localTask.taskType}
                metadata={localTask.taskMetadata}
                mode={mode}
                taskId={localTask.id}
                fetchWithAuth={fetchWithAuth}
                onMetadataUpdate={handleMetadataUpdate}
                onRunScript={linkedRunbook?.azureRunbookName ? () => setConfirmRunOpen(true) : undefined}
                onOpenScript={() => setLocation("/command/scripts")}
              />

              <div className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setTaskDetailsOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left bg-[#1C2128] hover:bg-[#30363D] transition-colors"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Task Details</p>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${colCfg.cls}`}>{colCfg.label}</span>
                    {priorityCfg && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 ${priorityCfg.cls}`}>
                        <span className={`w-1 h-1 rounded-full ${priorityCfg.dot}`} />{priorityCfg.label}
                      </span>
                    )}
                    {checklist.length > 0 && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${checkedCount === checklist.length ? "bg-green-500/15 text-green-400" : "bg-[#30363D] text-[#7D8590]"}`}>
                        {checkedCount}/{checklist.length} done
                      </span>
                    )}
                  </div>
                  <span className="material-symbols-outlined text-muted-foreground flex-shrink-0" style={{ fontSize: "18px" }}>
                    {taskDetailsOpen ? "expand_less" : "expand_more"}
                  </span>
                </button>
                {taskDetailsOpen && (
                  <div className="px-4 py-3 border-t border-border space-y-3">
                    {localTask.description && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Description</p>
                        <p className="text-sm text-[#E6EDF3] leading-relaxed">{localTask.description}</p>
                      </div>
                    )}
                    {(localTask.assignedTo || localTask.dueDate || stepTitle) && (
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        {localTask.assignedTo && (
                          <div className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            <span>{localTask.assignedTo}</span>
                          </div>
                        )}
                        {localTask.dueDate && (
                          <div className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span>Due {new Date(localTask.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                          </div>
                        )}
                        {stepTitle && (
                          <div className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            <span>Phase: {stepTitle}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {localTask.column === "waiting_on_customer" && localTask.waitingReason && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1.5">Waiting for</p>
                  <p className="text-sm text-amber-300 leading-relaxed whitespace-pre-wrap">{localTask.waitingReason}</p>
                </div>
              )}

              {localTask.column === "completed" && (localTask.completionStatus || localTask.completionNotes) && (
                <div className="space-y-3">
                  {localTask.completionStatus && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Result:</span>
                      <span className="text-xs font-semibold text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-2.5 py-0.5">
                        ✓ {localTask.completionStatus}
                      </span>
                    </div>
                  )}
                  {localTask.completionNotes && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Output / Notes</p>
                      <pre className="text-xs text-[#E6EDF3] bg-[#1C2128] border border-border rounded-lg px-3 py-2.5 whitespace-pre-wrap font-mono leading-relaxed max-h-52 overflow-y-auto">
                        {localTask.completionNotes}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {meta.lastRunResult && (
                <LastRunResultsSection result={meta.lastRunResult as LastRunResult} />
              )}

              {(meta.scriptOutput || meta.aiAnalysis) && (
                <AutoSavedScriptResultsSection
                  scriptOutput={meta.scriptOutput as string | undefined}
                  aiAnalysis={meta.aiAnalysis as AutoSavedAiAnalysis | undefined}
                  completedAt={meta.completedAt as string | undefined}
                  failedAt={meta.failedAt as string | undefined}
                  lastJobStatus={meta.lastJobStatus as string | undefined}
                />
              )}

              {mode === "admin" && fetchWithAuth && (
                <EngineerDetailSection
                  task={localTask}
                  fetchWithAuth={fetchWithAuth}
                  onMetadataUpdate={handleMetadataUpdate}
                />
              )}

              {(localTask.createdAt || localTask.updatedAt) && (
                <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground pt-2 border-t border-border">
                  {localTask.createdAt && (
                    <span>Created {new Date(localTask.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  )}
                  {localTask.updatedAt && localTask.updatedAt !== localTask.createdAt && (
                    <span>Updated {new Date(localTask.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  )}
                </div>
              )}
            </>
          ) : (
            /* ── GENERIC VIEW MODE ────────────────────────────────────────── */
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${colCfg.cls}`}>
                  {colCfg.label}
                </span>
                {priorityCfg && (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${priorityCfg.cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${priorityCfg.dot}`} />
                    {priorityCfg.label}
                  </span>
                )}
                {checklist.length > 0 && (
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${checkedCount === checklist.length ? "bg-green-500/15 text-green-400 border border-green-500/20" : "bg-[#30363D] text-[#7D8590] border border-[#30363D]"}`}>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    {checkedCount}/{checklist.length} done
                  </span>
                )}
              </div>

              {localTask.description && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Description</p>
                  <p className="text-sm text-[#E6EDF3] leading-relaxed">{localTask.description}</p>
                </div>
              )}

              {(localTask.assignedTo || localTask.dueDate || stepTitle) && (
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  {localTask.assignedTo && (
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span>{localTask.assignedTo}</span>
                    </div>
                  )}
                  {localTask.dueDate && (
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>Due {new Date(localTask.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    </div>
                  )}
                  {stepTitle && (
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      <span>Phase: {stepTitle}</span>
                    </div>
                  )}
                </div>
              )}

              {localTask.column === "waiting_on_customer" && localTask.waitingReason && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1.5">Waiting for</p>
                  <p className="text-sm text-amber-300 leading-relaxed whitespace-pre-wrap">{localTask.waitingReason}</p>
                </div>
              )}

              {localTask.column === "completed" && (localTask.completionStatus || localTask.completionNotes) && (
                <div className="space-y-3">
                  {localTask.completionStatus && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Result:</span>
                      <span className="text-xs font-semibold text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-2.5 py-0.5">
                        ✓ {localTask.completionStatus}
                      </span>
                    </div>
                  )}
                  {localTask.completionNotes && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Output / Notes</p>
                      <pre className="text-xs text-[#E6EDF3] bg-[#1C2128] border border-border rounded-lg px-3 py-2.5 whitespace-pre-wrap font-mono leading-relaxed max-h-52 overflow-y-auto">
                        {localTask.completionNotes}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {meta.lastRunResult && (
                <LastRunResultsSection result={meta.lastRunResult as LastRunResult} />
              )}

              {(meta.scriptOutput || meta.aiAnalysis) && (
                <AutoSavedScriptResultsSection
                  scriptOutput={meta.scriptOutput as string | undefined}
                  aiAnalysis={meta.aiAnalysis as AutoSavedAiAnalysis | undefined}
                  completedAt={meta.completedAt as string | undefined}
                  failedAt={meta.failedAt as string | undefined}
                  lastJobStatus={meta.lastJobStatus as string | undefined}
                />
              )}

              {mode === "admin" && fetchWithAuth && (
                <EngineerDetailSection
                  task={localTask}
                  fetchWithAuth={fetchWithAuth}
                  onMetadataUpdate={handleMetadataUpdate}
                />
              )}

              {(localTask.createdAt || localTask.updatedAt) && (
                <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground pt-2 border-t border-border">
                  {localTask.createdAt && (
                    <span>Created {new Date(localTask.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  )}
                  {localTask.updatedAt && localTask.updatedAt !== localTask.createdAt && (
                    <span>Updated {new Date(localTask.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {/* Run Script confirm dialog */}
    {confirmRunOpen && linkedRunbook?.azureRunbookName && (
      <RunScriptConfirmDialog
        scriptTitle={linkedRunbook.scriptTitle}
        azureRunbookName={linkedRunbook.azureRunbookName}
        clientName={clientName ?? null}
        onConfirm={() => void handleConfirmRun()}
        onCancel={() => setConfirmRunOpen(false)}
        disabled={scriptRunning}
      />
    )}

    {runDialogOpen && linkedRunbook?.azureRunbookName && (
      <RunLibraryScriptDialog
        scriptId={linkedRunbook.scriptId}
        scriptTitle={linkedRunbook.scriptTitle}
        azureRunbookName={linkedRunbook.azureRunbookName}
        initialClientId={clientId}
        initialAppRegistrationId={confirmedAppRegId}
        kanbanTaskId={localTask.id}
        autoRun
        onClose={() => {
          setRunDialogOpen(false);
          setConfirmedAppRegId(null);
          if (isActiveForTask(localTask.id)) setScriptRunning(true);
        }}
        onRunComplete={handleRunComplete}
      />
    )}
  </>
  );
}
