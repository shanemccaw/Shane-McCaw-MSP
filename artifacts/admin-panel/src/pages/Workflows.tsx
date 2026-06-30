import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { GenerateAssetsDialog } from "@/components/GenerateAssetsDialog";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ─── Constants ────────────────────────────────────────────────────────────────

const GROUP_OPTIONS = ["Engineer Tasks", "Artifacts Produced", "Client Deliverables"] as const;
type GroupOption = typeof GROUP_OPTIONS[number];

const TASK_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "discovery", label: "Discovery" },
  { value: "training", label: "Training" },
  { value: "environmentHealthCheck", label: "Environment Health Check" },
  { value: "governanceSetup", label: "Governance Setup" },
  { value: "automationBuild", label: "Automation Build" },
  { value: "documentDelivery", label: "Document Delivery" },
];

const TASK_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TASK_TYPE_OPTIONS.map(o => [o.value, o.label])
);

const EMPTY_TASK_FORM: EditingTaskForm = {
  title: "",
  groupName: "",
  taskType: "",
  description: "",
  instructions: [],
  checklist: [],
  artifactsProduced: [],
  clientDeliverables: [],
  instructionSetId: null,
  checklistId: null,
  artifactsId: null,
  deliverablesId: null,
  isCustomerTask: false,
  runbookId: null,
};

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface ChecklistItem {
  id: string;
  label: string;
}

interface AssetItem {
  id: number;
  title: string;
}

interface StepTask {
  id: number;
  title: string;
  description: string | null;
  groupName: string | null;
  taskType: string | null;
  order: number;
  workflowTemplateStepId: number | null;
  instructions: string[] | null;
  checklist: ChecklistItem[] | null;
  artifactsProduced: string[] | null;
  clientDeliverables: string[] | null;
  instructionSetId: number | null;
  checklistId: number | null;
  artifactsId: number | null;
  deliverablesId: number | null;
  requiresManualRun: boolean | null;
  isCustomerTask: boolean | null;
  runbookId: string | null;
}

interface WorkflowStep {
  id: number;
  workflowTemplateId: number;
  title: string;
  description: string | null;
  order: number;
  tasks?: StepTask[];
}

interface WorkflowTemplate {
  id: number;
  name: string;
  description: string | null;
  serviceId: number | null;
  steps?: WorkflowStep[];
}

interface Service { id: number; name: string; category?: string; workflowTemplateId?: number | null; }

interface EditingTaskForm {
  title: string;
  groupName: string;
  taskType: string;
  description: string;
  instructions: string[];
  checklist: ChecklistItem[];
  artifactsProduced: string[];
  clientDeliverables: string[];
  instructionSetId: number | null;
  checklistId: number | null;
  artifactsId: number | null;
  deliverablesId: number | null;
  isCustomerTask: boolean;
  runbookId: string | null;
}

interface PublishedScript {
  id: string;
  title: string;
}

// ─── Sub-editors ──────────────────────────────────────────────────────────────

function StringListEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  const addItem = () => onChange([...items, ""]);
  const removeItem = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, val: string) => onChange(items.map((v, idx) => idx === i ? val : v));
  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...items];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  };
  const moveDown = (i: number) => {
    if (i === items.length - 1) return;
    const next = [...items];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    onChange(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590]">{label}</span>
        <button type="button" onClick={addItem} className="text-[9px] font-semibold text-[#0078D4] hover:underline">
          + Add
        </button>
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="flex flex-col gap-0.5 flex-shrink-0">
              <button type="button" onClick={() => moveUp(i)} disabled={i === 0}
                className="p-0.5 text-[#484F58] hover:text-[#7D8590] disabled:opacity-20 leading-none">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button type="button" onClick={() => moveDown(i)} disabled={i === items.length - 1}
                className="p-0.5 text-[#484F58] hover:text-[#7D8590] disabled:opacity-20 leading-none">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            <input
              value={item}
              placeholder={placeholder ?? "Enter item…"}
              onChange={e => updateItem(i, e.target.value)}
              className="flex-1 border border-[#30363D] rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
            />
            <button type="button" onClick={() => removeItem(i)} className="flex-shrink-0 p-1 text-[#484F58] hover:text-red-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="text-[10px] text-[#7D8590] italic">No items yet.</p>}
      </div>
    </div>
  );
}

function ChecklistEditor({
  items,
  onChange,
}: {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}) {
  const addItem = () => onChange([...items, { id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: "" }]);
  const removeItem = (id: string) => onChange(items.filter(it => it.id !== id));
  const updateLabel = (id: string, label: string) => onChange(items.map(it => it.id === id ? { ...it, label } : it));
  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...items];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  };
  const moveDown = (i: number) => {
    if (i === items.length - 1) return;
    const next = [...items];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    onChange(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590]">Checklist</span>
        <button type="button" onClick={addItem} className="text-[9px] font-semibold text-[#0078D4] hover:underline">
          + Add item
        </button>
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={item.id} className="flex items-center gap-1">
            <div className="flex flex-col gap-0.5 flex-shrink-0">
              <button type="button" onClick={() => moveUp(i)} disabled={i === 0}
                className="p-0.5 text-[#484F58] hover:text-[#7D8590] disabled:opacity-20 leading-none">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button type="button" onClick={() => moveDown(i)} disabled={i === items.length - 1}
                className="p-0.5 text-[#484F58] hover:text-[#7D8590] disabled:opacity-20 leading-none">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            <span className="flex-shrink-0 w-3.5 h-3.5 rounded border border-[#30363D] bg-[#161B22]" />
            <input
              value={item.label}
              placeholder="Checklist item…"
              onChange={e => updateLabel(item.id, e.target.value)}
              className="flex-1 border border-[#30363D] rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
            />
            <button type="button" onClick={() => removeItem(item.id)} className="flex-shrink-0 p-1 text-[#484F58] hover:text-red-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="text-[10px] text-[#7D8590] italic">No checklist items yet.</p>}
      </div>
    </div>
  );
}

// ─── Sortable Step Card ────────────────────────────────────────────────────────

function SortableStepCard({
  step,
  idx,
  isSelected,
  readyCount,
  totalCount,
  onSelect,
  onDelete,
  onEditTitle,
  onGenerateScripts,
}: {
  step: WorkflowStep;
  idx: number;
  isSelected: boolean;
  readyCount: number;
  totalCount: number;
  onSelect: () => void;
  onDelete: () => void;
  onEditTitle: (id: number, title: string) => void;
  onGenerateScripts: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(step.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const taskCount = step.tasks?.length ?? 0;
  const missingCount = totalCount - readyCount;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const readyPct = totalCount > 0 ? (readyCount / totalCount) * 100 : 0;

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setEditVal(step.title);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commitEdit() {
    if (editVal.trim() && editVal.trim() !== step.title) {
      onEditTitle(step.id, editVal.trim());
    }
    setEditing(false);
  }

  function cancelEdit(e?: React.MouseEvent) {
    e?.stopPropagation();
    setEditVal(step.title);
    setEditing(false);
  }

  if (editing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`flex flex-col gap-2 px-3 py-2.5 rounded-lg border shadow-sm ${
          isSelected ? "bg-[#0078D4]/10 border-[#0078D4]" : "bg-[#161B22] border-[#0078D4]"
        }`}
      >
        <input
          ref={inputRef}
          value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.stopPropagation(); commitEdit(); }
            if (e.key === "Escape") { e.stopPropagation(); cancelEdit(); }
          }}
          className="w-full border border-[#0078D4] rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); commitEdit(); }}
            disabled={!editVal.trim()}
            className="text-xs bg-[#0078D4] text-white px-3 py-1 rounded font-medium hover:bg-[#006CBE] disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={cancelEdit}
            className="text-xs text-[#7D8590] hover:text-[#C9D1D9] px-2 py-1"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
        isSelected
          ? "bg-[#0078D4]/10 border-[#0078D4] shadow-sm"
          : "bg-[#161B22] border-[#30363D] hover:border-[#484F58] hover:bg-[#1C2128]"
      }`}
      onClick={onSelect}
    >
      {/* Top row: drag handle + step number + title + count + actions */}
      <div className="flex items-center gap-2">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="flex-shrink-0 p-0.5 text-[#484F58] hover:text-[#7D8590] cursor-grab active:cursor-grabbing"
          onClick={e => e.stopPropagation()}
          title="Drag to reorder"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="9" cy="7" r="1.5" /><circle cx="15" cy="7" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="17" r="1.5" /><circle cx="15" cy="17" r="1.5" />
          </svg>
        </button>

        {/* Step number badge */}
        <div className={`flex-shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
          isSelected ? "bg-[#0078D4] text-white" : "bg-[#30363D]/60 text-[#7D8590]"
        }`}>
          {idx + 1}
        </div>

        {/* Title + task count pill */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="text-sm font-medium text-[#E6EDF3] truncate leading-snug">{step.title}</span>
          {taskCount > 0 && (
            <span className="flex-shrink-0 text-[10px] text-[#7D8590] bg-[#1C2128] border border-[#30363D] rounded-full px-1.5 py-0.5 leading-none">
              {taskCount}
            </span>
          )}
          {missingCount > 0 && (
            <span
              className="flex-shrink-0 text-[9px] font-bold text-amber-400 border border-amber-500/30 rounded-full px-1.5 py-0.5 leading-none"
              title={`${missingCount} task${missingCount === 1 ? "" : "s"} missing asset sets`}
            >
              {missingCount}⚠
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={startEdit}
            className="p-1 text-[#484F58] hover:text-[#0078D4] rounded"
            title="Rename step"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={e => { e.stopPropagation(); onGenerateScripts(); }}
            disabled={taskCount === 0}
            className="p-1 text-[#484F58] hover:text-[#00B4D8] disabled:opacity-20 rounded"
            title={taskCount === 0 ? "No tasks to generate scripts for" : "Generate PowerShell scripts for this step's tasks"}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-1 text-[#484F58] hover:text-red-500 rounded"
            title="Delete step"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Progress bar — green ready / amber missing */}
      {totalCount > 0 && (
        <div className="ml-7 h-[3px] rounded-full overflow-hidden bg-amber-500/25">
          <div
            className={`h-full rounded-full transition-all duration-300 ${readyPct === 100 ? "bg-green-500" : "bg-green-500"}`}
            style={{ width: `${readyPct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Generate Step Scripts Dialog ──────────────────────────────────────────────

type ScriptGenPhase = "confirm" | "running" | "done" | "error";
type ScriptGenMode = "replace" | "append";

interface ScriptGenLogEntry {
  taskTitle: string;
  classification: string;
  saved: boolean;
  skipped: boolean;
}

interface ScriptGenState {
  phase: ScriptGenPhase;
  mode: ScriptGenMode;
  total: number;
  current: number;
  currentTaskTitle: string;
  currentStatus: "classifying" | "generating" | null;
  log: ScriptGenLogEntry[];
  summary: { packageId: string; packageTitle: string; generated: number; skipped: number; failed: number } | null;
  errorMsg: string | null;
}

const SCRIPT_GEN_INITIAL: ScriptGenState = {
  phase: "confirm",
  mode: "replace",
  total: 0,
  current: 0,
  currentTaskTitle: "",
  currentStatus: null,
  log: [],
  summary: null,
  errorMsg: null,
};

function GenerateStepScriptsDialog({
  templateId,
  step,
  open,
  onClose,
}: {
  templateId: number;
  step: WorkflowStep | null;
  open: boolean;
  onClose: () => void;
}) {
  const { fetchWithAuth } = useAuth();
  const [state, setState] = useState<ScriptGenState>(SCRIPT_GEN_INITIAL);
  const [packageExists, setPackageExists] = useState<boolean | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  // On open, check if a package with this step's name already exists
  useEffect(() => {
    if (!open || !step) return;
    setState(SCRIPT_GEN_INITIAL);
    setPackageExists(null);

    const expectedTitle = `${step.title} Scripts`;
    fetchWithAuth("/api/admin/ps-scripts/packages")
      .then(r => r.ok ? r.json() as Promise<Array<{ title: string }>> : Promise.resolve([]))
      .then(pkgs => {
        setPackageExists(pkgs.some(p => p.title === expectedTitle));
      })
      .catch(() => setPackageExists(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step?.id]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.log]);

  function handleClose() {
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => { /* ignore */ });
      readerRef.current = null;
    }
    onClose();
  }

  async function startGeneration() {
    if (!step) return;
    setState(s => ({ ...s, phase: "running", log: [], current: 0, total: 0 }));

    try {
      const res = await fetchWithAuth(
        `/api/admin/workflow-templates/${templateId}/steps/${step.id}/generate-scripts`,
        {
          method: "POST",
          headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
          body: JSON.stringify({ mode: state.mode }),
        }
      );

      if (!res.ok || !res.body) {
        setState(s => ({ ...s, phase: "error", errorMsg: "Server returned an error. Please try again." }));
        return;
      }

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line.slice(6)) as Record<string, unknown>; } catch { continue; }

          if (evt.type === "progress") {
            setState(s => ({
              ...s,
              total: (evt.total as number) ?? s.total,
              current: (evt.current as number) ?? s.current,
              currentTaskTitle: (evt.taskTitle as string) ?? s.currentTaskTitle,
              currentStatus: (evt.status as "classifying" | "generating") ?? null,
            }));
          } else if (evt.type === "task_done") {
            setState(s => ({
              ...s,
              total: (evt.total as number) ?? s.total,
              current: (evt.current as number) ?? s.current,
              log: [
                ...s.log,
                {
                  taskTitle: evt.taskTitle as string,
                  classification: evt.classification as string,
                  saved: Boolean(evt.saved),
                  skipped: Boolean(evt.skipped),
                },
              ],
            }));
          } else if (evt.type === "done") {
            setState(s => ({
              ...s,
              phase: "done",
              summary: {
                packageId: evt.packageId as string,
                packageTitle: evt.packageTitle as string,
                generated: evt.generated as number,
                skipped: evt.skipped as number,
                failed: evt.failed as number,
              },
            }));
          } else if (evt.type === "error") {
            setState(s => ({ ...s, phase: "error", errorMsg: evt.message as string }));
          }
        }
      }
    } catch {
      setState(s => ({ ...s, phase: "error", errorMsg: "Connection lost. Please try again." }));
    }
  }

  if (!open || !step) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={state.phase === "running" ? undefined : handleClose} />
      <div className="relative bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D] flex-shrink-0">
          <div>
            <h3 className="font-semibold text-[#E6EDF3] text-sm">Generate Scripts</h3>
            <p className="text-xs text-[#7D8590] mt-0.5 truncate max-w-[380px]">{step.title}</p>
          </div>
          {state.phase !== "running" && (
            <button onClick={handleClose} className="p-1.5 text-[#7D8590] hover:text-[#C9D1D9] rounded">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {state.phase === "confirm" && (
            <>
              {packageExists === null ? (
                <div className="flex items-center justify-center py-6 text-[#7D8590] text-xs gap-2">
                  <div className="w-4 h-4 border-2 border-[#7D8590] border-t-transparent rounded-full animate-spin" />
                  Checking for existing package…
                </div>
              ) : (
                <>
                  <p className="text-sm text-[#C9D1D9]">
                    AI will classify each task in <span className="font-semibold text-[#E6EDF3]">"{step.title}"</span>,
                    skip human-only tasks, and generate a PowerShell script for each automatable task.
                    Results are saved as a Script Package named{" "}
                    <span className="font-semibold text-[#00B4D8]">"{step.title} Scripts"</span>.
                  </p>
                  <div className="text-xs text-[#7D8590] bg-[#1C2128] rounded-lg px-3 py-2">
                    <span className="font-semibold text-[#E6EDF3]">{step.tasks?.length ?? 0}</span> task
                    {(step.tasks?.length ?? 0) !== 1 ? "s" : ""} will be classified
                    {packageExists && (
                      <span className="ml-2 text-amber-400">· A package named "{step.title} Scripts" already exists</span>
                    )}
                  </div>
                  {packageExists && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[#7D8590] mb-2">
                        Since the package already exists:
                      </p>
                      <div className="space-y-1.5">
                        {(["replace", "append"] as ScriptGenMode[]).map(m => (
                          <label key={m} className="flex items-start gap-2.5 cursor-pointer">
                            <input
                              type="radio"
                              name="script-gen-mode"
                              value={m}
                              checked={state.mode === m}
                              onChange={() => setState(s => ({ ...s, mode: m }))}
                              className="mt-0.5 accent-[#0078D4]"
                            />
                            <span className="text-sm text-[#C9D1D9]">
                              {m === "replace" ? (
                                <><span className="font-semibold text-[#E6EDF3]">Replace</span> — delete existing scripts and write fresh ones</>
                              ) : (
                                <><span className="font-semibold text-[#E6EDF3]">Append</span> — add new scripts to the existing package</>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {state.phase === "running" && (
            <>
              {/* Current task */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#7D8590]">
                    {state.currentStatus === "classifying"
                      ? "Classifying…"
                      : state.currentStatus === "generating"
                      ? "Generating script…"
                      : "Processing…"}
                  </span>
                  <span className="text-[#7D8590]">{state.current}/{state.total}</span>
                </div>
                <div className="w-full bg-[#30363D] rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full bg-[#00B4D8] transition-all duration-500"
                    style={{ width: state.total > 0 ? `${(state.current / state.total) * 100}%` : "0%" }}
                  />
                </div>
                {state.currentTaskTitle && (
                  <p className="text-xs text-[#C9D1D9] truncate">{state.currentTaskTitle}</p>
                )}
              </div>

              {/* Log */}
              {state.log.length > 0 && (
                <div ref={logRef} className="space-y-1 max-h-52 overflow-y-auto">
                  {state.log.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                      {entry.skipped ? (
                        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-[#7D8590]">—</span>
                      ) : entry.saved ? (
                        <svg className="w-4 h-4 flex-shrink-0 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 flex-shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span className={`truncate ${entry.skipped ? "text-[#484F58]" : entry.saved ? "text-[#C9D1D9]" : "text-red-400"}`}>
                        {entry.taskTitle}
                      </span>
                      <span className="flex-shrink-0 text-[9px] text-[#7D8590]">
                        {entry.skipped ? "skipped" : entry.saved ? "saved" : "failed"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {state.phase === "done" && state.summary && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#E6EDF3]">Scripts generated</p>
                  <p className="text-xs text-[#7D8590] mt-0.5">Saved to "{state.summary.packageTitle}"</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 text-center">
                  <p className="text-lg font-bold text-green-400">{state.summary.generated}</p>
                  <p className="text-[10px] text-[#7D8590] mt-0.5">Generated</p>
                </div>
                <div className="bg-[#1C2128] border border-[#30363D] rounded-lg px-3 py-2 text-center">
                  <p className="text-lg font-bold text-[#7D8590]">{state.summary.skipped}</p>
                  <p className="text-[10px] text-[#7D8590] mt-0.5">Skipped</p>
                </div>
                <div className={`rounded-lg px-3 py-2 text-center border ${state.summary.failed > 0 ? "bg-red-500/10 border-red-500/20" : "bg-[#1C2128] border-[#30363D]"}`}>
                  <p className={`text-lg font-bold ${state.summary.failed > 0 ? "text-red-400" : "text-[#7D8590]"}`}>{state.summary.failed}</p>
                  <p className="text-[10px] text-[#7D8590] mt-0.5">Failed</p>
                </div>
              </div>
              {/* Log */}
              {state.log.length > 0 && (
                <div ref={logRef} className="space-y-1 max-h-36 overflow-y-auto bg-[#1C2128] rounded-lg p-2">
                  {state.log.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                      {entry.skipped ? (
                        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-[#7D8590]">—</span>
                      ) : entry.saved ? (
                        <svg className="w-4 h-4 flex-shrink-0 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 flex-shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span className={`truncate ${entry.skipped ? "text-[#484F58]" : entry.saved ? "text-[#C9D1D9]" : "text-red-400"}`}>
                        {entry.taskTitle}
                      </span>
                      <span className="flex-shrink-0 text-[9px] text-[#7D8590]">
                        {entry.classification === "USER_ACCOUNT_REQUIRED" ? "UI+script" : entry.skipped ? "skipped" : entry.saved ? "saved" : "failed"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {/* CTA: View in Script Generator */}
              {state.summary.generated > 0 && (
                <a
                  href="/admin-panel/m365-scripts"
                  onClick={handleClose}
                  className="flex items-center justify-center gap-2 w-full bg-[#00B4D8]/10 hover:bg-[#00B4D8]/20 border border-[#00B4D8]/30 text-[#00B4D8] text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                  View in Script Generator
                </a>
              )}
            </div>
          )}

          {state.phase === "error" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-sm text-red-400">{state.errorMsg ?? "An unexpected error occurred."}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#30363D] flex-shrink-0">
          {state.phase === "confirm" && (
            <>
              <button onClick={handleClose} className="text-xs text-[#7D8590] hover:text-[#C9D1D9] px-3 py-1.5 rounded hover:bg-[#1C2128]">
                Cancel
              </button>
              <button
                onClick={() => void startGeneration()}
                disabled={packageExists === null}
                className="flex items-center gap-1.5 bg-[#00B4D8] text-white text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-[#0097B5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate Scripts
              </button>
            </>
          )}
          {state.phase === "running" && (
            <p className="text-xs text-[#7D8590] italic">Generating… please wait</p>
          )}
          {(state.phase === "done" || state.phase === "error") && (
            <button
              onClick={handleClose}
              className="bg-[#0078D4] text-white text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-[#006CBE] transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Runbook Combobox ──────────────────────────────────────────────────────────

function RunbookCombobox({
  value,
  onChange,
  scripts,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  scripts: PublishedScript[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = scripts.find(s => s.id === value) ?? null;
  const filtered = query.trim()
    ? scripts.filter(s => s.title.toLowerCase().includes(query.toLowerCase()))
    : scripts;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div
        className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#0D1117]"
        onClick={() => setOpen(o => !o)}
        tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setOpen(o => !o); }}
      >
        <span className={selected ? "text-[#E6EDF3]" : "text-[#484F58]"}>
          {selected ? selected.title : "None"}
        </span>
        <svg className="w-3.5 h-3.5 text-[#7D8590] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[#161B22] border border-[#30363D] rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-[#21262D]">
            <input
              autoFocus
              className="w-full bg-[#0D1117] border border-[#30363D] rounded px-2 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
              placeholder="Search runbooks…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            <li
              className="px-3 py-1.5 text-xs text-[#7D8590] hover:bg-[#1C2128] cursor-pointer"
              onClick={() => { onChange(null); setOpen(false); setQuery(""); }}
            >
              None
            </li>
            {filtered.map(s => (
              <li
                key={s.id}
                className={`px-3 py-1.5 text-xs cursor-pointer flex items-center gap-2 ${s.id === value ? "bg-[#0078D4]/10 text-[#0078D4]" : "text-[#E6EDF3] hover:bg-[#1C2128]"}`}
                onClick={() => { onChange(s.id); setOpen(false); setQuery(""); }}
              >
                {s.id === value && <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0" />}
                {s.title}
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-[#484F58]">No matching runbooks</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Sortable Task Row ─────────────────────────────────────────────────────────

function SortableTaskRow({
  task,
  onEdit,
  onDelete,
  onGenerateScript,
  instructionSets,
  checklists,
  artifactSets,
  deliverableSets,
  publishedScripts,
}: {
  task: StepTask;
  onEdit: (t: StepTask) => void;
  onDelete: (t: StepTask) => void;
  onGenerateScript: (t: StepTask) => Promise<void>;
  instructionSets: AssetItem[];
  checklists: AssetItem[];
  artifactSets: AssetItem[];
  deliverableSets: AssetItem[];
  publishedScripts: PublishedScript[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const [isGenerating, setIsGenerating] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const hasLibraryLinks = task.instructionSetId || task.checklistId || task.artifactsId || task.deliverablesId;
  const hasInlineDetail =
    (task.instructions && task.instructions.length > 0) ||
    (task.checklist && task.checklist.length > 0) ||
    (task.artifactsProduced && task.artifactsProduced.length > 0) ||
    (task.clientDeliverables && task.clientDeliverables.length > 0);
  const isMissingAssets =
    task.instructionSetId == null || task.checklistId == null ||
    task.artifactsId == null || task.deliverablesId == null;

  // Task type colour
  const taskTypeMeta: Record<string, { bg: string; text: string }> = {
    discovery:            { bg: "bg-blue-500/15",   text: "text-blue-400" },
    training:             { bg: "bg-teal-500/15",   text: "text-teal-400" },
    environmentHealthCheck: { bg: "bg-cyan-500/15",  text: "text-cyan-400" },
    governanceSetup:      { bg: "bg-indigo-500/15", text: "text-indigo-400" },
    automationBuild:      { bg: "bg-violet-500/15", text: "text-violet-400" },
    documentDelivery:     { bg: "bg-emerald-500/15","text": "text-emerald-400" },
  };
  const typeStyle = task.taskType ? (taskTypeMeta[task.taskType] ?? { bg: "bg-[#30363D]", text: "text-[#7D8590]" }) : null;

  // Asset chip helpers
  const instrName  = task.instructionSetId  ? (instructionSets.find(a => a.id === task.instructionSetId)?.title  ?? `#${task.instructionSetId}`)  : null;
  const clName     = task.checklistId       ? (checklists.find(a => a.id === task.checklistId)?.title            ?? `#${task.checklistId}`)        : null;
  const artName    = task.artifactsId       ? (artifactSets.find(a => a.id === task.artifactsId)?.title          ?? `#${task.artifactsId}`)        : null;
  const delName    = task.deliverablesId    ? (deliverableSets.find(a => a.id === task.deliverablesId)?.title     ?? `#${task.deliverablesId}`)    : null;
  const rbName     = task.runbookId         ? (publishedScripts.find(s => s.id === task.runbookId)?.title        ?? task.runbookId)                : null;

  const chipBase = "flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded border leading-none";
  const linkedChip = `${chipBase} bg-teal-500/10 text-teal-400 border-teal-500/25`;
  const missingChip = `${chipBase} bg-transparent text-[#484F58] border-[#30363D] border-dashed`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
        isMissingAssets
          ? "bg-amber-500/5 border-amber-500/20 hover:border-amber-400/40 hover:bg-amber-500/10"
          : "bg-[#161B22] border-[#30363D] hover:border-[#0078D4]/50 hover:bg-[#0078D4]/5"
      }`}
      onClick={() => onEdit(task)}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="flex-shrink-0 p-0.5 mt-0.5 text-[#484F58] hover:text-[#7D8590] cursor-grab active:cursor-grabbing"
        onClick={e => e.stopPropagation()}
        title="Drag to reorder"
      >
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="9" cy="7" r="1.5" /><circle cx="15" cy="7" r="1.5" />
          <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="17" r="1.5" /><circle cx="15" cy="17" r="1.5" />
        </svg>
      </button>

      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Line 1: title + type badge + missing flag */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-[#E6EDF3] leading-snug">{task.title}</span>
          {typeStyle && (
            <span className={`flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded leading-none ${typeStyle.bg} ${typeStyle.text}`}>
              {TASK_TYPE_LABELS[task.taskType!] ?? task.taskType}
            </span>
          )}
          {task.isCustomerTask && (
            <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded leading-none bg-amber-500/15 text-amber-400">
              Customer
            </span>
          )}
          {isMissingAssets && (
            <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-400 border border-amber-500/30 rounded-full px-1.5 py-0.5 leading-none">
              <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Missing sets
            </span>
          )}
        </div>

        {/* Line 2: asset set chips */}
        <div className="flex items-center gap-1 flex-wrap">
          {/* Runbook */}
          {rbName ? (
            <span className={`${chipBase} bg-[#0078D4]/15 text-[#0078D4] border-[#0078D4]/25`} title={`Runbook: ${rbName}`}>
              ▶ {rbName.length > 18 ? rbName.slice(0, 18) + "…" : rbName}
            </span>
          ) : null}
          {/* Instruction Set */}
          {instrName
            ? <span className={linkedChip} title={`Instructions: ${instrName}`}>Instr: {instrName.length > 14 ? instrName.slice(0, 14) + "…" : instrName}</span>
            : <span className={missingChip} title="No instruction set linked">Instr</span>
          }
          {/* Checklist */}
          {clName
            ? <span className={linkedChip} title={`Checklist: ${clName}`}>Check: {clName.length > 14 ? clName.slice(0, 14) + "…" : clName}</span>
            : <span className={missingChip} title="No checklist linked">Check</span>
          }
          {/* Artifacts */}
          {artName
            ? <span className={linkedChip} title={`Artifacts: ${artName}`}>Art: {artName.length > 14 ? artName.slice(0, 14) + "…" : artName}</span>
            : <span className={missingChip} title="No artifact set linked">Art</span>
          }
          {/* Deliverables */}
          {delName
            ? <span className={linkedChip} title={`Deliverables: ${delName}`}>Del: {delName.length > 14 ? delName.slice(0, 14) + "…" : delName}</span>
            : <span className={missingChip} title="No deliverable set linked">Del</span>
          }
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
        <button
          onClick={e => {
            e.stopPropagation();
            if (isGenerating) return;
            setIsGenerating(true);
            onGenerateScript(task).finally(() => setIsGenerating(false));
          }}
          disabled={isGenerating}
          className="p-1.5 text-[#7D8590] hover:text-violet-400 rounded hover:bg-violet-500/10 disabled:opacity-50 disabled:cursor-wait"
          title={task.runbookId ? "Regenerate PowerShell script" : "Generate PowerShell script for this task"}
        >
          {isGenerating ? (
            <div className="w-3.5 h-3.5 border border-violet-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          )}
        </button>
        <button
          onClick={() => onEdit(task)}
          className="p-1.5 text-[#7D8590] hover:text-[#0078D4] rounded hover:bg-[#0078D4]/10"
          title="Edit task"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button
          onClick={() => onDelete(task)}
          className="p-1.5 text-[#7D8590] hover:text-red-500 rounded hover:bg-red-500/10"
          title="Delete task"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Task Drawer ───────────────────────────────────────────────────────────────

type DrawerTab = "basic" | "assets" | "inline";

function TaskDrawer({
  open,
  isNew,
  form,
  setForm,
  onSave,
  onClose,
  instructionSets,
  checklists,
  artifactSets,
  deliverableSets,
  publishedScripts,
}: {
  open: boolean;
  isNew: boolean;
  form: EditingTaskForm;
  setForm: React.Dispatch<React.SetStateAction<EditingTaskForm>>;
  onSave: () => void;
  onClose: () => void;
  instructionSets: AssetItem[];
  checklists: AssetItem[];
  artifactSets: AssetItem[];
  deliverableSets: AssetItem[];
  publishedScripts: PublishedScript[];
}) {
  const [tab, setTab] = useState<DrawerTab>("basic");

  useEffect(() => {
    if (open) setTab("basic");
  }, [open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 z-40"
          onClick={onClose}
        />
      )}

      {/* Drawer panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[480px] bg-[#161B22] shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D] flex-shrink-0">
          <h3 className="font-semibold text-[#E6EDF3] text-base">
            {isNew ? "Add Task" : "Edit Task"}
          </h3>
          <button onClick={onClose} className="p-1.5 text-[#7D8590] hover:text-[#7D8590] rounded">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#30363D] px-5 flex-shrink-0">
          {(["basic", "assets", "inline"] as DrawerTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px ${
                tab === t
                  ? "border-[#0078D4] text-[#0078D4]"
                  : "border-transparent text-[#7D8590] hover:text-[#C9D1D9]"
              }`}
            >
              {t === "basic" ? "Basic" : t === "assets" ? "Asset Library" : "Inline Detail"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {tab === "basic" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-1 uppercase tracking-wide">Title *</label>
                <input
                  autoFocus
                  type="text"
                  value={form.title}
                  placeholder="Task title"
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1 uppercase tracking-wide">Group</label>
                  <select
                    value={form.groupName}
                    onChange={e => setForm(p => ({ ...p, groupName: e.target.value }))}
                    className="w-full border border-[#30363D] bg-[#0D1117] text-[#E6EDF3] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  >
                    <option value="">No group</option>
                    {GROUP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1 uppercase tracking-wide">Type</label>
                  <select
                    value={form.taskType}
                    onChange={e => setForm(p => ({ ...p, taskType: e.target.value }))}
                    className="w-full border border-[#30363D] bg-[#0D1117] text-[#E6EDF3] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  >
                    <option value="">No type</option>
                    {TASK_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-1 uppercase tracking-wide">Description</label>
                <textarea
                  value={form.description}
                  placeholder="Optional description…"
                  rows={4}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  className="w-full border border-[#30363D] bg-[#0D1117] text-[#E6EDF3] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                />
              </div>
              <div className={`flex items-start gap-3 rounded-lg border px-3 py-3 cursor-pointer select-none transition-colors ${
                form.isCustomerTask
                  ? "bg-amber-500/10 border-amber-500/30"
                  : "bg-[#0D1117] border-[#30363D] hover:border-[#484F58]"
              }`}
                onClick={() => setForm(p => ({ ...p, isCustomerTask: !p.isCustomerTask }))}
              >
                <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                  form.isCustomerTask ? "bg-amber-500 border-amber-500" : "border-[#484F58]"
                }`}>
                  {form.isCustomerTask && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#E6EDF3]">Customer Task</p>
                  <p className="text-[10px] text-[#7D8590] mt-0.5 leading-relaxed">
                    When added to the Kanban board, this task will land in the <span className="font-semibold text-amber-400">"Waiting For You"</span> bucket on the customer's board instead of Backlog.
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-1 uppercase tracking-wide">Linked Runbook</label>
                <RunbookCombobox
                  value={form.runbookId ?? null}
                  onChange={id => setForm(p => ({ ...p, runbookId: id }))}
                  scripts={publishedScripts}
                />
                <p className="text-[10px] text-[#7D8590] mt-1">
                  When set, a "Run Script" button will appear on this task's kanban card and modal.
                </p>
              </div>
            </>
          )}

          {tab === "assets" && (
            <>
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 mb-1">
                <p className="text-[10px] text-indigo-600 leading-relaxed">
                  Library links override inline fields when the task is instantiated. Select a library item to link it, or leave as "None" to use the inline fields on the Inline Detail tab.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-1 uppercase tracking-wide">Instruction Set</label>
                <select
                  value={form.instructionSetId ?? ""}
                  onChange={e => setForm(p => ({ ...p, instructionSetId: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                >
                  <option value="">None (use inline)</option>
                  {instructionSets.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-1 uppercase tracking-wide">Checklist</label>
                <select
                  value={form.checklistId ?? ""}
                  onChange={e => setForm(p => ({ ...p, checklistId: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                >
                  <option value="">None (use inline)</option>
                  {checklists.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-1 uppercase tracking-wide">Artifact Set</label>
                <select
                  value={form.artifactsId ?? ""}
                  onChange={e => setForm(p => ({ ...p, artifactsId: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                >
                  <option value="">None (use inline)</option>
                  {artifactSets.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-1 uppercase tracking-wide">Deliverable Set</label>
                <select
                  value={form.deliverablesId ?? ""}
                  onChange={e => setForm(p => ({ ...p, deliverablesId: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                >
                  <option value="">None (use inline)</option>
                  {deliverableSets.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              </div>
            </>
          )}

          {tab === "inline" && (
            <div className="space-y-6">
              <StringListEditor
                label="Instructions"
                items={form.instructions}
                onChange={items => setForm(p => ({ ...p, instructions: items }))}
                placeholder="Step-by-step instruction…"
              />
              <ChecklistEditor
                items={form.checklist}
                onChange={items => setForm(p => ({ ...p, checklist: items }))}
              />
              <StringListEditor
                label="Artifacts Produced"
                items={form.artifactsProduced}
                onChange={items => setForm(p => ({ ...p, artifactsProduced: items }))}
                placeholder="E.g. Gap Analysis Report"
              />
              <StringListEditor
                label="Client Deliverables"
                items={form.clientDeliverables}
                onChange={items => setForm(p => ({ ...p, clientDeliverables: items }))}
                placeholder="E.g. Executive Roadmap"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[#30363D] flex-shrink-0 bg-[#161B22]">
          <button
            onClick={onClose}
            className="text-sm text-[#7D8590] px-4 py-2 rounded-lg hover:bg-[#1C2128] font-medium"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!form.title.trim()}
            className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#006CBE] disabled:opacity-50 transition-colors"
          >
            {isNew ? "Add Task" : "Save Changes"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selected, setSelected] = useState<WorkflowTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detailForm, setDetailForm] = useState<{ name: string; description: string; serviceId: number | null }>({ name: "", description: "", serviceId: null });

  // Asset library
  const [instructionSets, setInstructionSets] = useState<AssetItem[]>([]);
  const [checklists, setChecklists] = useState<AssetItem[]>([]);
  const [artifactSets, setArtifactSets] = useState<AssetItem[]>([]);
  const [deliverableSets, setDeliverableSets] = useState<AssetItem[]>([]);
  const [publishedScripts, setPublishedScripts] = useState<PublishedScript[]>([]);

  // Two-column view: selected step
  const [selectedStepId, setSelectedStepId] = useState<number | null>(null);

  // Readiness cache: maps template ID -> { ready, total }
  const [readinessCache, setReadinessCache] = useState<Map<number, { ready: number; total: number }>>(new Map());

  // New step quick-add
  const [addingStep, setAddingStep] = useState(false);
  const [newStepTitle, setNewStepTitle] = useState("");

  // Task drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerIsNew, setDrawerIsNew] = useState(false);
  const [editingTask, setEditingTask] = useState<StepTask | null>(null);
  const [taskForm, setTaskForm] = useState<EditingTaskForm>(EMPTY_TASK_FORM);

  // Filter: show only tasks missing asset sets
  const [showMissingOnly, setShowMissingOnly] = useState(false);

  // Bulk Tools
  const [bulkOpen, setBulkOpen] = useState(false);
  const [jsonImportOpen, setJsonImportOpen] = useState(false);

  // AI Generate
  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [aiGenerateMode, setAiGenerateMode] = useState<"append" | "replace">("append");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGenerateResult, setAiGenerateResult] = useState<{ stepsCreated: number; tasksCreated: number } | null>(null);
  const [aiGenerateError, setAiGenerateError] = useState<string | null>(null);
  // Derive linked service from the authoritative reverse-lookup (services.workflowTemplateId)
  const aiGenerateService = aiGenerateOpen && selected
    ? (services.find(s => s.workflowTemplateId === selected.id) ?? null)
    : null;

  // AI asset generation
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);

  // Generate step scripts dialog
  const [generateScriptsStep, setGenerateScriptsStep] = useState<WorkflowStep | null>(null);
  const [jsonImportText, setJsonImportText] = useState("");
  const [jsonImporting, setJsonImporting] = useState(false);
  const [engImportOpen, setEngImportOpen] = useState(false);
  const [engImportText, setEngImportText] = useState("");
  const [engImporting, setEngImporting] = useState(false);

  // DnD sensors
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch the full export (steps + tasks included) so we can populate
      // readiness dots for every template without additional round-trips.
      const res = await fetchWithAuth("/api/admin/workflow-templates/export");
      if (!res.ok) return;
      const full = await res.json() as WorkflowTemplate[];
      setTemplates(full);
      // Build readiness cache for all templates at once
      const cache = new Map<number, { ready: number; total: number }>();
      for (const tmpl of full) {
        const allTasks = (tmpl.steps ?? []).flatMap(s => s.tasks ?? []);
        const ready = allTasks.filter(t =>
          t.instructionSetId != null && t.checklistId != null &&
          t.artifactsId != null && t.deliverablesId != null
        ).length;
        cache.set(tmpl.id, { ready, total: allTasks.length });
      }
      setReadinessCache(cache);
    } finally { setLoading(false); }
  }, [fetchWithAuth]);

  const fetchServices = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/services");
      if (!res.ok) return;
      setServices(await res.json() as Service[]);
    } catch { /* ignore */ }
  }, [fetchWithAuth]);

  const fetchAssetLibrary = useCallback(async () => {
    try {
      const [instrRes, clRes, artRes, delRes] = await Promise.all([
        fetchWithAuth("/api/admin/asset-library/instruction-sets"),
        fetchWithAuth("/api/admin/asset-library/checklists"),
        fetchWithAuth("/api/admin/asset-library/artifact-sets"),
        fetchWithAuth("/api/admin/asset-library/deliverable-sets"),
      ]);
      if (instrRes.ok) setInstructionSets(await instrRes.json() as AssetItem[]);
      if (clRes.ok) setChecklists(await clRes.json() as AssetItem[]);
      if (artRes.ok) setArtifactSets(await artRes.json() as AssetItem[]);
      if (delRes.ok) setDeliverableSets(await delRes.json() as AssetItem[]);
    } catch { /* ignore */ }
  }, [fetchWithAuth]);

  const fetchPublishedScripts = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/ps-scripts/published");
      if (res.ok) {
        const data = await res.json() as { id: string; title: string }[];
        setPublishedScripts(data);
      }
    } catch { /* ignore */ }
  }, [fetchWithAuth]);

  useEffect(() => {
    void fetchTemplates();
    void fetchServices();
    void fetchAssetLibrary();
    void fetchPublishedScripts();
  }, [fetchTemplates, fetchServices, fetchAssetLibrary, fetchPublishedScripts]);

  // Sync the "Default Service" dropdown with the authoritative reverse-lookup.
  // services.workflowTemplateId is the source of truth; we derive the linked
  // service for the selected template by scanning the services list.
  useEffect(() => {
    if (!selected) return;
    const linkedId = services.find(s => s.workflowTemplateId === selected.id)?.id ?? null;
    setDetailForm(p => ({ ...p, serviceId: linkedId }));
  }, [selected?.id, services]);

  const selectTemplate = useCallback(async (t: WorkflowTemplate) => {
    try {
      const res = await fetchWithAuth(`/api/admin/workflow-templates/${t.id}`);
      if (!res.ok) return;
      const data = await res.json() as WorkflowTemplate;
      setSelected(data);
      // serviceId is synced via useEffect below using the authoritative services reverse-lookup
      setDetailForm({ name: data.name, description: data.description ?? "", serviceId: null });
      setSelectedStepId(null);
      setDrawerOpen(false);
      setAddingStep(false);
      setNewStepTitle("");
      setJsonImportOpen(false);
      setJsonImportText("");
      setEngImportOpen(false);
      setEngImportText("");
      setShowMissingOnly(false);
      // Populate readiness cache for this template
      const allTasks = (data.steps ?? []).flatMap(s => s.tasks ?? []);
      const ready = allTasks.filter(tk =>
        tk.instructionSetId != null && tk.checklistId != null &&
        tk.artifactsId != null && tk.deliverablesId != null
      ).length;
      setReadinessCache(prev => new Map(prev).set(data.id, { ready, total: allTasks.length }));
    } catch { /* ignore */ }
  }, [fetchWithAuth]);

  const refreshSelected = useCallback(async () => {
    if (!selected) return;
    try {
      const res = await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}`);
      if (!res.ok) return;
      const data = await res.json() as WorkflowTemplate;
      setSelected(data);
      const allTasks = (data.steps ?? []).flatMap(s => s.tasks ?? []);
      const ready = allTasks.filter(tk =>
        tk.instructionSetId != null && tk.checklistId != null &&
        tk.artifactsId != null && tk.deliverablesId != null
      ).length;
      setReadinessCache(prev => new Map(prev).set(data.id, { ready, total: allTasks.length }));
    } catch { /* ignore */ }
  }, [fetchWithAuth, selected]);

  // ── Template CRUD ──────────────────────────────────────────────────────────

  async function createTemplate() {
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/admin/workflow-templates", {
        method: "POST",
        body: JSON.stringify({ name: "New Workflow Template" }),
      });
      if (!res.ok) { toast({ title: "Failed to create", variant: "destructive" }); return; }
      const t = await res.json() as WorkflowTemplate;
      await fetchTemplates();
      await selectTemplate(t);
    } finally { setSaving(false); }
  }

  async function saveTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      // Save name + description on the template (serviceId is no longer stored here)
      const res = await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: detailForm.name, description: detailForm.description || null }),
      });
      if (!res.ok) { toast({ title: "Failed to save", variant: "destructive" }); return; }

      // Update the service link via services.workflowTemplateId (authoritative)
      await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/service-link`, {
        method: "PUT",
        body: JSON.stringify({ serviceId: detailForm.serviceId }),
      });

      toast({ title: "Template saved" });
      await Promise.all([fetchTemplates(), fetchServices()]);
    } finally { setSaving(false); }
  }

  async function deleteTemplate() {
    if (!selected) return;
    if (!confirm(`Delete "${selected.name}"?`)) return;
    await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}`, { method: "DELETE" });
    setSelected(null);
    await fetchTemplates();
    toast({ title: "Template deleted" });
  }

  // ── Step CRUD ──────────────────────────────────────────────────────────────

  async function addStep() {
    if (!selected || !newStepTitle.trim()) return;
    const maxOrder = (selected.steps ?? []).reduce((m, s) => Math.max(m, s.order), -1);
    const res = await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/steps`, {
      method: "POST",
      body: JSON.stringify({ title: newStepTitle.trim(), description: null, order: maxOrder + 1 }),
    });
    if (!res.ok) { toast({ title: "Failed to add step", variant: "destructive" }); return; }
    const created = await res.json() as WorkflowStep;
    setNewStepTitle("");
    setAddingStep(false);
    await refreshSelected();
    setSelectedStepId(created.id);
  }

  async function saveStepTitle(stepId: number, title: string) {
    if (!selected) return;
    const step = (selected.steps ?? []).find(s => s.id === stepId);
    if (!step) return;
    const res = await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/steps/${stepId}`, {
      method: "PUT",
      body: JSON.stringify({ title, description: step.description || null, order: step.order }),
    });
    if (!res.ok) { toast({ title: "Failed to rename step", variant: "destructive" }); return; }
    await refreshSelected();
  }

  async function deleteStep(stepId: number) {
    if (!selected) return;
    if (!confirm("Delete this step and all its tasks?")) return;
    await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/steps/${stepId}`, { method: "DELETE" });
    if (selectedStepId === stepId) setSelectedStepId(null);
    await refreshSelected();
  }

  async function moveStep(step: WorkflowStep, direction: "up" | "down") {
    if (!selected || !selected.steps) return;
    const steps = [...selected.steps].sort((a, b) => a.order - b.order);
    const idx = steps.findIndex(s => s.id === step.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= steps.length) return;
    const reordered = steps.map((s, i) => {
      if (i === idx) return { id: s.id, order: steps[swapIdx].order };
      if (i === swapIdx) return { id: s.id, order: steps[idx].order };
      return { id: s.id, order: s.order };
    });
    await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/steps/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ steps: reordered }),
    });
    await refreshSelected();
  }

  async function handleStepDragEnd(event: DragEndEvent) {
    if (!selected?.steps) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const sorted = [...selected.steps].sort((a, b) => a.order - b.order);
    const oldIdx = sorted.findIndex(s => s.id === active.id);
    const newIdx = sorted.findIndex(s => s.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(sorted, oldIdx, newIdx).map((s, i) => ({ id: s.id, order: i }));
    await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/steps/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ steps: reordered }),
    });
    await refreshSelected();
  }

  // ── Task CRUD ──────────────────────────────────────────────────────────────

  function openDrawerNew() {
    setEditingTask(null);
    setTaskForm(EMPTY_TASK_FORM);
    setDrawerIsNew(true);
    setDrawerOpen(true);
  }

  function openDrawerEdit(task: StepTask) {
    setEditingTask(task);
    setTaskForm({
      title: task.title,
      groupName: task.groupName ?? "",
      taskType: task.taskType ?? "",
      description: task.description ?? "",
      instructions: task.instructions ?? [],
      checklist: task.checklist ?? [],
      artifactsProduced: task.artifactsProduced ?? [],
      clientDeliverables: task.clientDeliverables ?? [],
      instructionSetId: task.instructionSetId ?? null,
      checklistId: task.checklistId ?? null,
      artifactsId: task.artifactsId ?? null,
      deliverablesId: task.deliverablesId ?? null,
      isCustomerTask: task.isCustomerTask ?? false,
      runbookId: task.runbookId ?? null,
    });
    setDrawerIsNew(false);
    setDrawerOpen(true);
  }

  async function saveTask() {
    if (!selected || !selectedStepId || !taskForm.title.trim()) return;

    const bodyBase = {
      title: taskForm.title.trim(),
      description: taskForm.description || null,
      groupName: taskForm.groupName || null,
      taskType: taskForm.taskType || null,
      instructions: taskForm.instructions.filter(Boolean).length > 0 ? taskForm.instructions.filter(Boolean) : null,
      checklist: taskForm.checklist.filter(c => c.label.trim()).length > 0 ? taskForm.checklist.filter(c => c.label.trim()) : null,
      artifactsProduced: taskForm.artifactsProduced.filter(Boolean).length > 0 ? taskForm.artifactsProduced.filter(Boolean) : null,
      clientDeliverables: taskForm.clientDeliverables.filter(Boolean).length > 0 ? taskForm.clientDeliverables.filter(Boolean) : null,
      instructionSetId: taskForm.instructionSetId,
      checklistId: taskForm.checklistId,
      artifactsId: taskForm.artifactsId,
      deliverablesId: taskForm.deliverablesId,
      isCustomerTask: taskForm.isCustomerTask,
      runbookId: taskForm.runbookId || null,
    };

    if (drawerIsNew) {
      const stepTasks = selectedStep?.tasks ?? [];
      const maxOrder = stepTasks.reduce((m, t) => Math.max(m, t.order), -1);
      const res = await fetchWithAuth(
        `/api/admin/workflow-templates/${selected.id}/steps/${selectedStepId}/tasks`,
        { method: "POST", body: JSON.stringify({ ...bodyBase, order: maxOrder + 1 }) }
      );
      if (!res.ok) { toast({ title: "Failed to add task", variant: "destructive" }); return; }
    } else {
      if (!editingTask) return;
      const res = await fetchWithAuth(
        `/api/admin/workflow-templates/${selected.id}/steps/${editingTask.workflowTemplateStepId}/tasks/${editingTask.id}`,
        { method: "PUT", body: JSON.stringify({ ...bodyBase, order: editingTask.order }) }
      );
      if (!res.ok) { toast({ title: "Failed to save task", variant: "destructive" }); return; }
    }

    setDrawerOpen(false);
    await refreshSelected();
  }

  async function deleteTask(task: StepTask) {
    if (!selected) return;
    if (!confirm(`Delete task "${task.title}"?`)) return;
    await fetchWithAuth(
      `/api/admin/workflow-templates/${selected.id}/steps/${task.workflowTemplateStepId}/tasks/${task.id}`,
      { method: "DELETE" }
    );
    await refreshSelected();
  }

  async function generateTaskScript(task: StepTask) {
    const res = await fetchWithAuth("/api/admin/ps-scripts/generate-from-task", {
      method: "POST",
      body: JSON.stringify({ taskId: task.id }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      toast({ title: "Script generation failed", description: err.error ?? "Please try again.", variant: "destructive" });
      return;
    }
    const result = await res.json() as { type: string; title: string; runbookId?: string; explanation?: string };
    if (result.type === "human-only") {
      toast({ title: "Task requires human action", description: result.explanation ?? "This task cannot be automated with PowerShell." });
    } else {
      toast({ title: "Script generated", description: `"${result.title}" saved to Script Library and linked to this task.` });
    }
    await refreshSelected();
  }

  async function handleTaskDragEnd(event: DragEndEvent) {
    if (!selected || !selectedStep) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const tasks = [...(selectedStep.tasks ?? [])].sort((a, b) => a.order - b.order);
    const oldIdx = tasks.findIndex(t => t.id === active.id);
    const newIdx = tasks.findIndex(t => t.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(tasks, oldIdx, newIdx);
    // PATCH each task order via existing API
    await Promise.all(
      reordered.map((t, i) =>
        fetchWithAuth(
          `/api/admin/workflow-templates/${selected.id}/steps/${t.workflowTemplateStepId}/tasks/${t.id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              title: t.title,
              description: t.description ?? null,
              groupName: t.groupName ?? null,
              taskType: t.taskType ?? null,
              order: i,
              instructions: t.instructions ?? null,
              checklist: t.checklist ?? null,
              artifactsProduced: t.artifactsProduced ?? null,
              clientDeliverables: t.clientDeliverables ?? null,
              instructionSetId: t.instructionSetId ?? null,
              checklistId: t.checklistId ?? null,
              artifactsId: t.artifactsId ?? null,
              deliverablesId: t.deliverablesId ?? null,
              isCustomerTask: t.isCustomerTask ?? false,
              runbookId: t.runbookId ?? null,
            }),
          }
        )
      )
    );
    await refreshSelected();
  }

  // ── Bulk Tools: AI Generate ────────────────────────────────────────────────

  async function runAiGenerate() {
    if (!selected) return;
    setAiGenerating(true);
    setAiGenerateResult(null);
    setAiGenerateError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/ai-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: aiGenerateMode }),
      });
      const data = await res.json() as { stepsCreated?: number; tasksCreated?: number; error?: string };
      if (!res.ok) {
        setAiGenerateError(data.error ?? "Generation failed");
        return;
      }
      const counts = { stepsCreated: data.stepsCreated ?? 0, tasksCreated: data.tasksCreated ?? 0 };
      setAiGenerateResult(counts);
      toast({ title: `Generated ${counts.stepsCreated} step${counts.stepsCreated !== 1 ? "s" : ""} and ${counts.tasksCreated} task${counts.tasksCreated !== 1 ? "s" : ""}` });
      await refreshSelected();
    } catch {
      setAiGenerateError("Network error — please try again");
    } finally {
      setAiGenerating(false);
    }
  }

  // ── Bulk Tools: JSON import ────────────────────────────────────────────────

  type ImportTask = { title: string; groupName?: string; description?: string; instructionSetId?: number | null; checklistId?: number | null; artifactsId?: number | null; deliverablesId?: number | null; instructions?: string[]; checklist?: ChecklistItem[]; artifactsProduced?: string[]; clientDeliverables?: string[] };
  type ImportStep = { title: string; description?: string; tasks?: ImportTask[] };

  function parseTemplateSteps(text: string): { parsed: ImportStep[] | null; error: string | null } {
    if (!text.trim()) return { parsed: null, error: null };
    try {
      const raw: unknown = JSON.parse(text);
      if (!Array.isArray(raw)) return { parsed: null, error: "JSON must be an array [ … ]" };
      if (raw.length === 0) return { parsed: null, error: "Array is empty" };
      const items = raw as Array<Record<string, unknown>>;
      const missingTitle = items.findIndex(s => !s.title || typeof s.title !== "string" || !(s.title as string).trim());
      if (missingTitle !== -1) return { parsed: null, error: `Step at index ${missingTitle} is missing a "title"` };
      for (let i = 0; i < items.length; i++) {
        const tasks = items[i].tasks;
        if (tasks !== undefined && !Array.isArray(tasks)) return { parsed: null, error: `Step at index ${i}: "tasks" must be an array` };
        if (Array.isArray(tasks)) {
          const badTask = (tasks as Array<Record<string, unknown>>).findIndex(t => !t.title || typeof t.title !== "string" || !(t.title as string).trim());
          if (badTask !== -1) return { parsed: null, error: `Step ${i + 1}, task at index ${badTask} is missing a "title"` };
        }
      }
      return { parsed: items as ImportStep[], error: null };
    } catch (e) {
      return { parsed: null, error: (e as SyntaxError).message };
    }
  }

  async function importStepsFromJson() {
    if (!selected) return;
    const { parsed, error } = parseTemplateSteps(jsonImportText);
    if (error || !parsed) return;
    setJsonImporting(true);
    try {
      const maxOrder = (selected.steps ?? []).reduce((m, s) => Math.max(m, s.order), -1);
      let totalTasks = 0;
      for (let i = 0; i < parsed.length; i++) {
        const s = parsed[i];
        const stepRes = await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/steps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: s.title.trim(), description: s.description?.trim() || null, order: maxOrder + 1 + i }),
        });
        if (!stepRes.ok) {
          toast({ title: `Failed at step ${i + 1}`, variant: "destructive" });
          await refreshSelected();
          return;
        }
        const createdStep = await stepRes.json() as { id: number };
        for (let j = 0; j < (s.tasks ?? []).length; j++) {
          const t = s.tasks![j];
          const taskRes = await fetchWithAuth(
            `/api/admin/workflow-templates/${selected.id}/steps/${createdStep.id}/tasks`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: t.title.trim(),
                description: t.description?.trim() || null,
                groupName: t.groupName?.trim() || null,
                order: j,
                instructionSetId: t.instructionSetId ?? null,
                checklistId: t.checklistId ?? null,
                artifactsId: t.artifactsId ?? null,
                deliverablesId: t.deliverablesId ?? null,
                instructions: t.instructions ?? null,
                checklist: t.checklist ?? null,
                artifactsProduced: t.artifactsProduced ?? null,
                clientDeliverables: t.clientDeliverables ?? null,
              }),
            }
          );
          if (!taskRes.ok) {
            toast({ title: `Failed at step ${i + 1} task ${j + 1}`, variant: "destructive" });
            await refreshSelected();
            return;
          }
          totalTasks++;
        }
      }
      setJsonImportOpen(false);
      setJsonImportText("");
      await refreshSelected();
      const taskNote = totalTasks > 0 ? ` and ${totalTasks} task${totalTasks !== 1 ? "s" : ""}` : "";
      toast({ title: "Import complete", description: `${parsed.length} step${parsed.length !== 1 ? "s" : ""}${taskNote} added.` });
    } finally {
      setJsonImporting(false);
    }
  }

  // ── Bulk Tools: Engineer-fields import ────────────────────────────────────

  type EngImportItem = { title: string; instructions?: string[]; checklist?: ChecklistItem[]; artifactsProduced?: string[]; clientDeliverables?: string[] };

  function parseEngineerFields(text: string): { parsed: EngImportItem[] | null; error: string | null } {
    if (!text.trim()) return { parsed: null, error: null };
    try {
      const raw: unknown = JSON.parse(text);
      if (!Array.isArray(raw)) return { parsed: null, error: "JSON must be an array [ … ]" };
      if (raw.length === 0) return { parsed: null, error: "Array is empty" };
      const items = raw as Array<Record<string, unknown>>;
      const badIdx = items.findIndex(x => !x.title || typeof x.title !== "string" || !(x.title as string).trim());
      if (badIdx !== -1) return { parsed: null, error: `Item at index ${badIdx} is missing a "title"` };
      return { parsed: items as EngImportItem[], error: null };
    } catch (e) {
      return { parsed: null, error: (e as SyntaxError).message };
    }
  }

  async function importEngineerFields() {
    if (!selected) return;
    const { parsed, error } = parseEngineerFields(engImportText);
    if (error || !parsed) return;
    setEngImporting(true);
    try {
      const allTasks: StepTask[] = (selected.steps ?? []).flatMap(s => s.tasks ?? []);
      const byTitle = new Map<string, StepTask[]>();
      for (const t of allTasks) {
        const key = t.title.trim().toLowerCase();
        if (!byTitle.has(key)) byTitle.set(key, []);
        byTitle.get(key)!.push(t);
      }
      let updated = 0;
      let skipped = 0;
      for (const item of parsed) {
        const key = item.title.trim().toLowerCase();
        const matches = byTitle.get(key) ?? [];
        if (matches.length === 0) { skipped++; continue; }
        for (const task of matches) {
          const res = await fetchWithAuth(
            `/api/admin/workflow-templates/${selected.id}/steps/${task.workflowTemplateStepId}/tasks/${task.id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: task.title,
                description: task.description ?? null,
                groupName: task.groupName ?? null,
                order: task.order,
                instructions: item.instructions?.filter(Boolean).length ? item.instructions!.filter(Boolean) : (task.instructions ?? null),
                checklist: item.checklist?.filter(c => c.label.trim()).length ? item.checklist!.filter(c => c.label.trim()) : (task.checklist ?? null),
                artifactsProduced: item.artifactsProduced?.filter(Boolean).length ? item.artifactsProduced!.filter(Boolean) : (task.artifactsProduced ?? null),
                clientDeliverables: item.clientDeliverables?.filter(Boolean).length ? item.clientDeliverables!.filter(Boolean) : (task.clientDeliverables ?? null),
              }),
            }
          );
          if (res.ok) updated++;
        }
      }
      await refreshSelected();
      setEngImportOpen(false);
      setEngImportText("");
      const skipNote = skipped > 0 ? ` (${skipped} title${skipped !== 1 ? "s" : ""} not matched)` : "";
      toast({ title: "Engineer fields imported", description: `${updated} task${updated !== 1 ? "s" : ""} updated${skipNote}.` });
    } finally {
      setEngImporting(false);
    }
  }

  async function handleExportAllTemplates() {
    try {
      const res = await fetchWithAuth("/api/admin/workflow-templates/export");
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json() as unknown;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `workflow-templates-export-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Export failed", description: "Could not fetch templates for export.", variant: "destructive" });
    }
  }

  function exportToJson() {
    if (!selected) return;
    const sorted = (selected.steps ?? []).slice().sort((a, b) => a.order - b.order);
    const payload = sorted.map(s => ({
      title: s.title,
      ...(s.description ? { description: s.description } : {}),
      tasks: (s.tasks ?? []).slice().sort((a, b) => a.order - b.order).map(t => ({
        title: t.title,
        ...(t.groupName ? { groupName: t.groupName } : {}),
        ...(t.description ? { description: t.description } : {}),
        ...(t.instructionSetId != null ? { instructionSetId: t.instructionSetId } : {}),
        ...(t.checklistId != null ? { checklistId: t.checklistId } : {}),
        ...(t.artifactsId != null ? { artifactsId: t.artifactsId } : {}),
        ...(t.deliverablesId != null ? { deliverablesId: t.deliverablesId } : {}),
        ...(t.instructions?.length ? { instructions: t.instructions } : {}),
        ...(t.checklist?.length ? { checklist: t.checklist } : {}),
        ...(t.artifactsProduced?.length ? { artifactsProduced: t.artifactsProduced } : {}),
        ...(t.clientDeliverables?.length ? { clientDeliverables: t.clientDeliverables } : {}),
      })),
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selected.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-steps.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── AI: Generate asset sets ────────────────────────────────────────────────

  function handleGenerateAssetSets() {
    if (!selected || generateDialogOpen) return;
    setGenerateDialogOpen(true);
  }

  async function handleGenerateDialogClose() {
    setGenerateDialogOpen(false);
    await refreshSelected();
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const steps = (selected?.steps ?? []).slice().sort((a, b) => a.order - b.order);
  const selectedStep = steps.find(s => s.id === selectedStepId) ?? null;
  const allStepTasks = (selectedStep?.tasks ?? []).slice().sort((a, b) => a.order - b.order);

  const allTemplateTasks = (selected?.steps ?? []).flatMap(s => s.tasks ?? []);
  const totalTaskCount = allTemplateTasks.length;
  const readyTaskCount = allTemplateTasks.filter(t =>
    t.instructionSetId != null && t.checklistId != null &&
    t.artifactsId != null && t.deliverablesId != null
  ).length;

  const tasksMissingAssets = totalTaskCount - readyTaskCount;
  const linkedService = services.find(s => s.workflowTemplateId === selected?.id) ?? null;

  // Per-step readiness: readyCount and totalCount
  const stepReadiness = new Map<number, { ready: number; total: number }>(
    steps.map(s => {
      const tasks = s.tasks ?? [];
      const ready = tasks.filter(t =>
        t.instructionSetId != null && t.checklistId != null &&
        t.artifactsId != null && t.deliverablesId != null
      ).length;
      return [s.id, { ready, total: tasks.length }];
    })
  );

  const stepMissingCounts = new Map<number, number>(
    steps.map(s => [s.id, (stepReadiness.get(s.id)?.total ?? 0) - (stepReadiness.get(s.id)?.ready ?? 0)])
  );

  const stepMissingCount = stepMissingCounts.get(selectedStepId ?? -1) ?? 0;

  const stepTasks = showMissingOnly
    ? allStepTasks.filter(t =>
        t.instructionSetId == null || t.checklistId == null ||
        t.artifactsId == null || t.deliverablesId == null
      )
    : allStepTasks;

  // Group tasks for display
  const tasksByGroup: Record<string, StepTask[]> = {};
  for (const t of stepTasks) {
    const key = t.groupName ?? "Other";
    if (!tasksByGroup[key]) tasksByGroup[key] = [];
    tasksByGroup[key].push(t);
  }
  const renderedGroups = [...GROUP_OPTIONS, "Other"].filter(g => tasksByGroup[g]?.length) as string[];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Template list sidebar ──────────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 border-r border-[#30363D] bg-[#161B22] overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-[#30363D] flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-[#E6EDF3] text-sm">Workflow Templates</h2>
            <p className="text-xs text-[#7D8590] mt-0.5">{templates.length} templates</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void handleExportAllTemplates()}
              disabled={templates.length === 0}
              title="Download all templates as JSON"
              className="flex items-center gap-1 text-xs text-[#7D8590] hover:text-[#0078D4] px-2.5 py-1.5 rounded-lg border border-[#30363D] hover:border-[#0078D4] hover:bg-[#0078D4]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export All
            </button>
            <button
              onClick={() => void createTemplate()}
              disabled={saving}
              className="bg-[#0078D4] text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60"
            >
              + New
            </button>
          </div>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-[#7D8590]">Loading…</div>
        ) : templates.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-[#7D8590] mb-3">No templates yet.</p>
            <button
              onClick={() => void createTemplate()}
              disabled={saving}
              className="bg-[#0078D4] text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60"
            >
              + Create your first template
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
            {templates.map(t => {
              const linkedSvc = services.find(s => s.workflowTemplateId === t.id);
              const rc = readinessCache.get(t.id);
              const stepCount = t.steps?.length ?? null;
              const taskCount = t.steps?.flatMap(s => s.tasks ?? []).length ?? null;
              const isActive = selected?.id === t.id;

              let dotColor = "bg-[#30363D]";
              if (rc) {
                if (rc.total === 0) dotColor = "bg-[#30363D]";
                else if (rc.ready === rc.total) dotColor = "bg-green-500";
                else dotColor = "bg-amber-500";
              }

              return (
                <button
                  key={t.id}
                  onClick={() => void selectTemplate(t)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                    isActive
                      ? "bg-[#0078D4]/10 border-[#0078D4]"
                      : "bg-[#0D1117] border-[#21262D] hover:border-[#30363D] hover:bg-[#1C2128]"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`flex-shrink-0 mt-1.5 w-2 h-2 rounded-full ${dotColor}`} title={
                      !rc ? "Not yet loaded" :
                      rc.total === 0 ? "No tasks" :
                      rc.ready === rc.total ? "All tasks ready" :
                      `${rc.total - rc.ready} tasks missing sets`
                    } />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-snug truncate ${isActive ? "text-[#0078D4]" : "text-[#E6EDF3]"}`}>{t.name}</p>
                      {linkedSvc && (
                        <p className="text-[10px] text-[#7D8590] mt-0.5 truncate">{linkedSvc.name}</p>
                      )}
                      {rc && (
                        <p className="text-[9px] text-[#484F58] mt-0.5">
                          {rc.ready}/{rc.total} ready
                          {stepCount != null && ` · ${stepCount} step${stepCount !== 1 ? "s" : ""}`}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      {!selected ? (
        <div className="flex-1 flex items-center justify-center bg-[#0D1117]">
          <div className="text-center max-w-xs">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#1C2128] border border-[#30363D] flex items-center justify-center">
              <svg className="w-8 h-8 text-[#484F58]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4h4v4H4zM16 4h4v4h-4zM4 16h4v4H4zM16 16h4v4h-4zM8 6h8M6 8v8M18 8v8M8 18h8" />
              </svg>
            </div>
            <h3 className="text-[#E6EDF3] font-semibold text-base mb-2">Workflow Templates</h3>
            <p className="text-[#7D8590] text-sm leading-relaxed mb-5">
              Templates define the steps and tasks that get generated when a service is activated for a client. Select a template from the sidebar or create a new one.
            </p>
            <button
              onClick={() => void createTemplate()}
              disabled={saving}
              className="bg-[#0078D4] text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60"
            >
              + Create your first template
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* ── Command Bar ─────────────────────────────────────────────────── */}
          <form onSubmit={saveTemplate} className="flex-shrink-0 border-b border-[#21262D] bg-[#0D1117] px-4 py-3">
            <div className="flex items-center gap-3">
              {/* Left: fields */}
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-[#484F58] mb-0.5">Name</label>
                  <input
                    type="text"
                    value={detailForm.name}
                    required
                    onChange={e => setDetailForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full bg-[#161B22] border border-[#30363D] rounded-md px-2.5 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:ring-1 focus:ring-[#0078D4] focus:border-[#0078D4]"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-[#484F58] mb-0.5">Description</label>
                  <input
                    type="text"
                    value={detailForm.description}
                    onChange={e => setDetailForm(p => ({ ...p, description: e.target.value }))}
                    className="w-full bg-[#161B22] border border-[#30363D] rounded-md px-2.5 py-1.5 text-sm text-[#E6EDF3] placeholder-[#484F58] focus:outline-none focus:ring-1 focus:ring-[#0078D4] focus:border-[#0078D4]"
                    placeholder="Optional"
                  />
                </div>
                <div className="w-44 flex-shrink-0">
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-[#484F58] mb-0.5">Default Service</label>
                  <select
                    value={detailForm.serviceId ?? ""}
                    onChange={e => setDetailForm(p => ({ ...p, serviceId: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full bg-[#161B22] border border-[#30363D] text-[#E6EDF3] rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                  >
                    <option value="">None</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Divider */}
              <div className="flex-shrink-0 w-px h-8 bg-[#21262D]" />

              {/* Right: health badge + actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Health badge */}
                {totalTaskCount > 0 && (
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold ${
                    readyTaskCount === totalTaskCount
                      ? "bg-green-500/10 border-green-500/25 text-green-400"
                      : "bg-amber-500/10 border-amber-500/25 text-amber-400"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${readyTaskCount === totalTaskCount ? "bg-green-400" : "bg-amber-400"}`} />
                    {readyTaskCount}/{totalTaskCount} tasks ready
                  </div>
                )}

                {/* Generate Asset Sets */}
                <button
                  type="button"
                  onClick={handleGenerateAssetSets}
                  disabled={generateDialogOpen || tasksMissingAssets === 0}
                  title={
                    tasksMissingAssets > 0
                      ? `Generate asset sets for ${tasksMissingAssets} task${tasksMissingAssets === 1 ? "" : "s"} missing sets`
                      : "All tasks already have asset sets linked"
                  }
                  className="flex items-center gap-1.5 text-xs font-medium text-purple-400 hover:text-purple-300 px-3 py-1.5 border border-purple-500/30 rounded-md hover:bg-purple-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate Asset Sets
                  {tasksMissingAssets > 0 && (
                    <span className="text-[9px] bg-purple-500/20 text-purple-300 rounded px-1 py-0.5 leading-none font-bold">{tasksMissingAssets}</span>
                  )}
                </button>

                {/* Delete */}
                <button
                  type="button"
                  onClick={deleteTemplate}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-400 px-3 py-1.5 border border-red-500/20 rounded-md hover:bg-red-500/10 transition-colors"
                >
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>

                {/* Save */}
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-1.5 bg-[#0078D4] text-white rounded-md px-3 py-1.5 text-xs font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60"
                >
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </form>

          {/* Two-column body */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* ── Steps column ──────────────────────────────────────────── */}
            <div className="w-72 flex-shrink-0 border-r border-[#30363D] bg-[#0D1117] flex flex-col overflow-hidden">
              {/* Steps header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#21262D] flex-shrink-0">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#7D8590]">
                  Steps
                  <span className="ml-1.5 text-[#484F58] font-normal normal-case tracking-normal">({steps.length})</span>
                </h3>
              </div>

              {/* Bulk toolbar — always visible above step list */}
              {(() => {
                const hasLinkedService = services.some(s => s.workflowTemplateId === selected.id);
                return (
                  <div className="flex-shrink-0 flex items-center gap-0.5 px-2 py-1.5 border-b border-[#21262D] bg-[#161B22]">
                    <button
                      onClick={exportToJson}
                      title="Export steps as JSON"
                      className="flex items-center gap-1 text-[10px] font-medium text-[#7D8590] hover:text-[#0078D4] px-2 py-1 rounded hover:bg-[#0078D4]/10 transition-colors"
                    >
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 8v-2a2 2 0 00-2-2H5a2 2 0 00-2 2v2M9 12l3-3 3 3M12 21V9" />
                      </svg>
                      Export
                    </button>
                    <button
                      onClick={() => { setJsonImportOpen(v => !v); setEngImportOpen(false); setAiGenerateOpen(false); setJsonImportText(""); }}
                      title="Import steps from JSON"
                      className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded transition-colors ${
                        jsonImportOpen ? "bg-[#00B4D8]/15 text-[#00B4D8]" : "text-[#7D8590] hover:text-[#00B4D8] hover:bg-[#00B4D8]/10"
                      }`}
                    >
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 16v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2M9 12l3 3 3-3M12 3v12" />
                      </svg>
                      Import
                    </button>
                    <button
                      onClick={() => { setEngImportOpen(v => !v); setJsonImportOpen(false); setAiGenerateOpen(false); setEngImportText(""); }}
                      title="Import engineer fields by task title"
                      className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded transition-colors ${
                        engImportOpen ? "bg-purple-500/15 text-purple-400" : "text-[#7D8590] hover:text-purple-400 hover:bg-purple-500/10"
                      }`}
                    >
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      Eng Fields
                    </button>
                    <button
                      onClick={() => {
                        if (!hasLinkedService) return;
                        setAiGenerateOpen(v => !v);
                        setJsonImportOpen(false);
                        setEngImportOpen(false);
                        setAiGenerateResult(null);
                        setAiGenerateError(null);
                      }}
                      disabled={!hasLinkedService}
                      title={!hasLinkedService ? "Link a service to this template first" : "Generate steps & tasks from the linked service using AI"}
                      className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded transition-colors ${
                        !hasLinkedService
                          ? "text-[#484F58] cursor-not-allowed opacity-50"
                          : aiGenerateOpen
                          ? "bg-violet-500/15 text-violet-400"
                          : "text-[#7D8590] hover:text-violet-400 hover:bg-violet-500/10"
                      }`}
                    >
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      AI Gen
                    </button>
                  </div>
                );
              })()}

              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {/* Import panels — inline above step list */}
                {jsonImportOpen && (() => {
                  const { parsed, error } = parseTemplateSteps(jsonImportText);
                  return (
                    <div className="rounded-lg border border-[#00B4D8]/30 bg-[#00B4D8]/5 p-3 space-y-2">
                      <p className="text-[10px] font-bold text-[#00B4D8] uppercase tracking-wide">Import from JSON</p>
                      <textarea
                        autoFocus
                        rows={6}
                        value={jsonImportText}
                        onChange={e => setJsonImportText(e.target.value)}
                        placeholder={`[\n  {\n    "title": "Discovery",\n    "tasks": [\n      { "title": "Review tenant" }\n    ]\n  }\n]`}
                        className="w-full bg-[#0D1117] border border-[#30363D] rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-[#00B4D8] resize-y"
                      />
                      {jsonImportText.trim() && error && (
                        <p className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1 font-mono">{error}</p>
                      )}
                      {parsed && parsed.length > 0 && (
                        <p className="text-[10px] text-[#7D8590]">
                          {parsed.length} step{parsed.length !== 1 ? "s" : ""} · {parsed.reduce((n, s) => n + (s.tasks?.length ?? 0), 0)} tasks
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          disabled={!parsed || jsonImporting}
                          onClick={() => void importStepsFromJson()}
                          className="bg-[#0078D4] text-white text-[10px] font-semibold px-3 py-1.5 rounded hover:bg-[#006CBE] disabled:opacity-40 flex items-center gap-1"
                        >
                          {jsonImporting
                            ? <><div className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Importing…</>
                            : `Import ${parsed ? parsed.length : ""} Step${parsed?.length !== 1 ? "s" : ""}`}
                        </button>
                        <button type="button" onClick={() => { setJsonImportOpen(false); setJsonImportText(""); }}
                          className="text-[10px] font-medium px-2 py-1.5 rounded hover:bg-[#30363D] text-[#7D8590]">
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {engImportOpen && (() => {
                  const { parsed, error } = parseEngineerFields(engImportText);
                  const allTasks: StepTask[] = (selected.steps ?? []).flatMap(s => s.tasks ?? []);
                  const byTitle = new Map<string, StepTask[]>();
                  for (const t of allTasks) {
                    const key = t.title.trim().toLowerCase();
                    if (!byTitle.has(key)) byTitle.set(key, []);
                    byTitle.get(key)!.push(t);
                  }
                  const matchCount = parsed ? parsed.filter(item => (byTitle.get(item.title.trim().toLowerCase()) ?? []).length > 0).length : 0;
                  const skipCount = parsed ? parsed.length - matchCount : 0;
                  return (
                    <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 space-y-2">
                      <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wide">Import Engineer Fields</p>
                      <p className="text-[9px] text-[#7D8590]">Paste tasks by title — only the 4 engineer fields are updated.</p>
                      <textarea
                        autoFocus
                        rows={6}
                        value={engImportText}
                        onChange={e => setEngImportText(e.target.value)}
                        placeholder={`[\n  {\n    "title": "Review tenant",\n    "instructions": ["Log into admin"]\n  }\n]`}
                        className="w-full bg-[#0D1117] border border-[#30363D] rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-purple-500 resize-y"
                      />
                      {engImportText.trim() && error && (
                        <p className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1 font-mono">{error}</p>
                      )}
                      {parsed && parsed.length > 0 && (
                        <p className="text-[10px] text-[#7D8590]">
                          {matchCount} will update{skipCount > 0 && <span className="text-amber-400 ml-1">· {skipCount} not matched</span>}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          disabled={!parsed || matchCount === 0 || engImporting}
                          onClick={() => void importEngineerFields()}
                          className="bg-purple-600 text-white text-[10px] font-semibold px-3 py-1.5 rounded hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1"
                        >
                          {engImporting
                            ? <><div className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Importing…</>
                            : `Update ${matchCount} Task${matchCount !== 1 ? "s" : ""}`}
                        </button>
                        <button type="button" onClick={() => { setEngImportOpen(false); setEngImportText(""); }}
                          className="text-[10px] font-medium px-2 py-1.5 rounded hover:bg-[#30363D] text-[#7D8590]">
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* AI Generate panel */}
                {aiGenerateOpen && services.some(s => s.workflowTemplateId === selected.id) && (
                  <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-3">
                    {aiGenerateService && (
                      <div className="rounded bg-violet-900/20 border border-violet-500/20 px-2 py-1.5">
                        <p className="text-[10px] font-semibold text-violet-300 leading-snug">{aiGenerateService.name}</p>
                        {aiGenerateService.category && (
                          <p className="text-[9px] text-violet-500 mt-0.5">{aiGenerateService.category}</p>
                        )}
                      </div>
                    )}
                    <p className="text-[10px] text-[#7D8590] leading-snug">
                      Claude reads the linked service and generates a complete set of workflow steps and engineer tasks.
                    </p>
                    <div>
                      <p className="text-[9px] font-bold text-[#484F58] uppercase tracking-wide mb-1.5">Mode</p>
                      <div className="flex gap-1.5">
                        {(["replace", "append"] as const).map(m => (
                          <button
                            key={m}
                            onClick={() => setAiGenerateMode(m)}
                            className={`flex-1 text-[10px] font-semibold py-1 rounded border transition-colors capitalize ${
                              aiGenerateMode === m
                                ? "bg-violet-600 text-white border-violet-500"
                                : "text-[#7D8590] border-[#30363D] hover:border-violet-500/50 hover:text-violet-300"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                      <p className="text-[9px] text-[#484F58] mt-1">
                        {aiGenerateMode === "replace" ? "⚠ Clears all existing steps first" : "Appends after existing steps"}
                      </p>
                    </div>
                    {aiGenerateError && (
                      <p className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5">{aiGenerateError}</p>
                    )}
                    {aiGenerateResult && (
                      <p className="text-[10px] text-green-400 bg-green-500/10 border border-green-500/20 rounded px-2 py-1.5">
                        ✓ {aiGenerateResult.stepsCreated} step{aiGenerateResult.stepsCreated !== 1 ? "s" : ""} · {aiGenerateResult.tasksCreated} task{aiGenerateResult.tasksCreated !== 1 ? "s" : ""} created
                      </p>
                    )}
                    <button
                      onClick={() => void runAiGenerate()}
                      disabled={aiGenerating}
                      className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white py-2 rounded-lg transition-colors"
                    >
                      {aiGenerating ? (
                        <>
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Generating…
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                          Generate Workflow
                        </>
                      )}
                    </button>
                  </div>
                )}

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e: DragEndEvent) => void handleStepDragEnd(e)}>
                  <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    {steps.map((step, idx) => {
                      const sr = stepReadiness.get(step.id) ?? { ready: 0, total: 0 };
                      return (
                        <SortableStepCard
                          key={step.id}
                          step={step}
                          idx={idx}
                          isSelected={selectedStepId === step.id}
                          readyCount={sr.ready}
                          totalCount={sr.total}
                          onSelect={() => { setSelectedStepId(step.id); setShowMissingOnly(false); }}
                          onDelete={() => void deleteStep(step.id)}
                          onEditTitle={(id, title) => void saveStepTitle(id, title)}
                          onGenerateScripts={() => setGenerateScriptsStep(step)}
                        />
                      );
                    })}
                  </SortableContext>
                </DndContext>

                {steps.length === 0 && !addingStep && (
                  <div className="rounded-lg border border-dashed border-[#30363D] px-4 py-6 text-center">
                    <svg className="w-6 h-6 text-[#484F58] mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                    </svg>
                    <p className="text-[11px] text-[#484F58]">No steps yet</p>
                    <button
                      onClick={() => setAddingStep(true)}
                      className="mt-2 text-[10px] text-[#0078D4] hover:underline font-medium"
                    >
                      Add your first step
                    </button>
                  </div>
                )}
              </div>

              {/* Add step */}
              <div className="flex-shrink-0 p-2.5 border-t border-[#21262D] bg-[#0D1117]">
                {addingStep ? (
                  <div className="space-y-2">
                    <input
                      autoFocus
                      type="text"
                      value={newStepTitle}
                      placeholder="Step title…"
                      onChange={e => setNewStepTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") void addStep();
                        if (e.key === "Escape") { setAddingStep(false); setNewStepTitle(""); }
                      }}
                      className="w-full bg-[#161B22] border border-[#30363D] rounded px-2.5 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => void addStep()}
                        disabled={!newStepTitle.trim()}
                        className="flex-1 bg-[#0078D4] text-white text-xs font-semibold py-1.5 rounded-lg hover:bg-[#006CBE] disabled:opacity-50"
                      >
                        Add Step
                      </button>
                      <button
                        onClick={() => { setAddingStep(false); setNewStepTitle(""); }}
                        className="text-xs text-[#7D8590] px-3 py-1.5 hover:text-[#C9D1D9]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingStep(true)}
                    className="w-full bg-[#161B22] border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] hover:border-[#484F58] text-xs font-medium py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Step
                  </button>
                )}
              </div>
            </div>

            {/* ── Task panel ────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#0D1117]">
              {!selectedStep ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center max-w-xs">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-[#161B22] border border-[#30363D] flex items-center justify-center">
                      <svg className="w-6 h-6 text-[#484F58]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
                      </svg>
                    </div>
                    <p className="text-sm text-[#7D8590]">Select a step to manage its tasks</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Task panel header */}
                  <div className="flex items-center justify-between px-5 py-3 border-b border-[#21262D] flex-shrink-0 bg-[#0D1117]">
                    <div>
                      <h3 className="font-semibold text-[#E6EDF3] text-sm">{selectedStep.title}</h3>
                      <p className="text-[10px] text-[#7D8590] mt-0.5">
                        {showMissingOnly
                          ? `${stepTasks.length} of ${allStepTasks.length} task${allStepTasks.length !== 1 ? "s" : ""} missing sets`
                          : `${allStepTasks.length} task${allStepTasks.length !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                    {stepMissingCount > 0 && (
                      <button
                        onClick={() => setShowMissingOnly(v => !v)}
                        className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors ${
                          showMissingOnly
                            ? "bg-amber-500 text-white border-amber-500 hover:bg-amber-600"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
                        }`}
                        title={showMissingOnly ? "Show all tasks" : `Filter to ${stepMissingCount} task${stepMissingCount === 1 ? "" : "s"} missing asset sets`}
                      >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {showMissingOnly ? "Show all" : `${stepMissingCount} missing`}
                      </button>
                    )}
                  </div>

                  {/* Task list */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                    {stepTasks.length === 0 && (
                      showMissingOnly
                        ? (
                          <div className="flex flex-col items-center gap-2 py-10 text-center">
                            <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-sm font-medium text-green-400">All tasks have asset sets linked.</p>
                            <button onClick={() => setShowMissingOnly(false)} className="text-xs text-[#7D8590] hover:underline">Show all tasks</button>
                          </div>
                        )
                        : (
                          <div className="rounded-lg border border-dashed border-[#30363D] px-5 py-8 text-center">
                            <svg className="w-8 h-8 text-[#484F58] mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            <p className="text-sm text-[#7D8590] mb-1">No tasks yet for this step</p>
                            <button onClick={openDrawerNew} className="text-xs text-[#0078D4] hover:underline font-medium">
                              Add your first task for this step
                            </button>
                          </div>
                        )
                    )}

                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e: DragEndEvent) => void handleTaskDragEnd(e)}>
                      <SortableContext items={stepTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                        {renderedGroups.length > 0 ? (
                          renderedGroups.map(group => (
                            <div key={group}>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-[#7D8590]">{group}</span>
                                <div className="flex-1 h-px bg-[#1C2128]" />
                              </div>
                              <div className="space-y-1.5">
                                {(tasksByGroup[group] ?? []).map(task => (
                                  <SortableTaskRow
                                    key={task.id}
                                    task={task}
                                    onEdit={openDrawerEdit}
                                    onDelete={t => void deleteTask(t)}
                                    onGenerateScript={t => generateTaskScript(t)}
                                    instructionSets={instructionSets}
                                    checklists={checklists}
                                    artifactSets={artifactSets}
                                    deliverableSets={deliverableSets}
                                    publishedScripts={publishedScripts}
                                  />
                                ))}
                              </div>
                            </div>
                          ))
                        ) : null}
                      </SortableContext>
                    </DndContext>
                  </div>

                  {/* Add Task button */}
                  <div className="flex-shrink-0 px-5 py-4 border-t border-[#21262D] bg-[#0D1117]">
                    <button
                      onClick={openDrawerNew}
                      className="w-full bg-[#0078D4] text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-[#006CBE] transition-colors flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Task
                    </button>
                  </div>
                </>
              )}

            </div>
          </div>

          {/* ── VS Code-style status bar ─────────────────────────────────── */}
          <div className="flex-shrink-0 h-7 bg-[#0078D4] flex items-center px-3 gap-4 text-[10px] font-medium text-white/80 border-t border-[#0078D4]">
            <span className="flex items-center gap-1">
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h4v4H4zM16 4h4v4h-4zM4 16h4v4H4zM16 16h4v4h-4zM8 6h8M6 8v8M18 8v8M8 18h8" />
              </svg>
              {steps.length} step{steps.length !== 1 ? "s" : ""}
            </span>
            <span className="text-white/40">·</span>
            <span>{totalTaskCount} task{totalTaskCount !== 1 ? "s" : ""}</span>
            <span className="text-white/40">·</span>
            <span className={readyTaskCount === totalTaskCount && totalTaskCount > 0 ? "text-white" : "text-amber-200"}>
              {readyTaskCount}/{totalTaskCount} ready
            </span>
            {linkedService && (
              <>
                <span className="text-white/40">·</span>
                <span className="flex items-center gap-1 text-white/70">
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  {linkedService.name}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Task drawer ─────────────────────────────────────────────────────── */}
      <TaskDrawer
        open={drawerOpen}
        isNew={drawerIsNew}
        form={taskForm}
        setForm={setTaskForm}
        onSave={() => void saveTask()}
        onClose={() => setDrawerOpen(false)}
        instructionSets={instructionSets}
        checklists={checklists}
        artifactSets={artifactSets}
        deliverableSets={deliverableSets}
        publishedScripts={publishedScripts}
      />

      {/* ── Generate assets dialog ──────────────────────────────────────────── */}
      {selected && (
        <GenerateAssetsDialog
          templateId={selected.id}
          open={generateDialogOpen}
          onClose={() => void handleGenerateDialogClose()}
        />
      )}

      {/* ── Generate step scripts dialog ─────────────────────────────────────── */}
      {selected && (
        <GenerateStepScriptsDialog
          templateId={selected.id}
          step={generateScriptsStep}
          open={generateScriptsStep !== null}
          onClose={() => setGenerateScriptsStep(null)}
        />
      )}
    </div>
  );
}
