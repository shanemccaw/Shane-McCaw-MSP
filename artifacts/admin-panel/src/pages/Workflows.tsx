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

interface Service { id: number; name: string; }

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
  totalSteps,
  isSelected,
  missingCount,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
  onEditTitle,
  onGenerateScripts,
}: {
  step: WorkflowStep;
  idx: number;
  totalSteps: number;
  isSelected: boolean;
  missingCount: number;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onEditTitle: (id: number, title: string) => void;
  onGenerateScripts: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(step.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const taskCount = step.tasks?.length ?? 0;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

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
      className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
        isSelected
          ? "bg-[#0078D4]/10 border-[#0078D4] shadow-sm"
          : "bg-[#161B22] border-[#30363D] hover:border-[#30363D] hover:bg-[#1C2128]"
      }`}
      onClick={onSelect}
    >
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

      {/* Step number */}
      <div className={`flex-shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
        isSelected ? "bg-[#0078D4] text-white" : "bg-[#30363D]/50 text-[#7D8590]"
      }`}>
        {idx + 1}
      </div>

      {/* Title + task count */}
      <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
        <span className="text-sm font-medium text-[#E6EDF3] truncate block leading-snug">{step.title}</span>
        {taskCount > 0 && (
          <span className="flex-shrink-0 text-[10px] text-[#7D8590] bg-[#1C2128] rounded-full px-1.5 py-0.5">
            {taskCount}
          </span>
        )}
        {missingCount > 0 && (
          <span
            className="flex-shrink-0 text-[9px] font-bold bg-amber-500/100/15 text-amber-400 border border-amber-500/30 rounded-full px-1.5 py-0.5 leading-none"
            title={`${missingCount} task${missingCount === 1 ? "" : "s"} missing asset sets`}
          >
            {missingCount}
          </span>
        )}
      </div>

      {/* Action buttons — always visible */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={startEdit}
          className="p-1 text-[#7D8590] hover:text-[#0078D4] rounded"
          title="Rename step"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button
          onClick={e => { e.stopPropagation(); onGenerateScripts(); }}
          disabled={(step.tasks?.length ?? 0) === 0}
          className="p-1 text-[#484F58] hover:text-[#00B4D8] disabled:opacity-20 rounded"
          title={taskCount === 0 ? "No tasks to generate scripts for" : "Generate PowerShell scripts for this step's tasks"}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </button>
        <button
          onClick={e => { e.stopPropagation(); onMoveUp(); }}
          disabled={idx === 0}
          className="p-1 text-[#484F58] hover:text-[#7D8590] disabled:opacity-20 rounded"
          title="Move up"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          onClick={e => { e.stopPropagation(); onMoveDown(); }}
          disabled={idx === totalSteps - 1}
          className="p-1 text-[#484F58] hover:text-[#7D8590] disabled:opacity-20 rounded"
          title="Move down"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
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
                  href="/admin-panel/script-generator"
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

// ─── Sortable Task Row ─────────────────────────────────────────────────────────

function SortableTaskRow({
  task,
  onEdit,
  onDelete,
  instructionSets,
  checklists,
  artifactSets,
  deliverableSets,
}: {
  task: StepTask;
  onEdit: (t: StepTask) => void;
  onDelete: (t: StepTask) => void;
  instructionSets: AssetItem[];
  checklists: AssetItem[];
  artifactSets: AssetItem[];
  deliverableSets: AssetItem[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
        isMissingAssets
          ? "bg-amber-500/10 border-amber-500/20 hover:border-amber-400 hover:bg-amber-500/20"
          : "bg-[#161B22] border-[#30363D] hover:border-[#0078D4] hover:bg-[#0078D4]/10"
      }`}
      onClick={() => onEdit(task)}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="flex-shrink-0 p-0.5 text-[#484F58] hover:text-[#7D8590] cursor-grab active:cursor-grabbing"
        onClick={e => e.stopPropagation()}
        title="Drag to reorder"
      >
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="9" cy="7" r="1.5" /><circle cx="15" cy="7" r="1.5" />
          <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="17" r="1.5" /><circle cx="15" cy="17" r="1.5" />
        </svg>
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-[#E6EDF3] leading-snug">{task.title}</span>
          {isMissingAssets && (
            <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold bg-amber-200 text-amber-400 border border-amber-500/30 rounded-full px-1.5 py-0.5 leading-none">
              <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Missing sets
            </span>
          )}
        </div>
        {(hasInlineDetail || hasLibraryLinks || task.taskType) && (
          <div className="flex flex-wrap gap-1 mt-1">
            {task.taskType && (
              <span className="text-[9px] bg-cyan-50 text-cyan-700 border border-cyan-200 px-1.5 py-0.5 rounded font-semibold">
                🏷 {TASK_TYPE_LABELS[task.taskType] ?? task.taskType}
              </span>
            )}
            {task.instructionSetId && (() => {
              const name = instructionSets.find(a => a.id === task.instructionSetId)?.title ?? `#${task.instructionSetId}`;
              return (
                <span className="text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded font-semibold" title={`Instruction Set: ${name}`}>
                  📚 {name}
                </span>
              );
            })()}
            {!task.instructionSetId && task.instructions && task.instructions.length > 0 && (
              <span className="text-[9px] bg-purple-50 text-purple-600 border border-purple-100 px-1.5 py-0.5 rounded font-semibold">
                {task.instructions.length} instruction{task.instructions.length !== 1 ? "s" : ""}
              </span>
            )}
            {task.checklistId && (() => {
              const name = checklists.find(a => a.id === task.checklistId)?.title ?? `#${task.checklistId}`;
              return (
                <span className="text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded font-semibold" title={`Checklist: ${name}`}>
                  ✅ {name}
                </span>
              );
            })()}
            {!task.checklistId && task.checklist && task.checklist.length > 0 && (
              <span className="text-[9px] bg-[#0078D4]/10 text-[#0078D4] border border-blue-100 px-1.5 py-0.5 rounded font-semibold">
                {task.checklist.length} checklist item{task.checklist.length !== 1 ? "s" : ""}
              </span>
            )}
            {task.artifactsId && (() => {
              const name = artifactSets.find(a => a.id === task.artifactsId)?.title ?? `#${task.artifactsId}`;
              return (
                <span className="text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded font-semibold" title={`Artifact Set: ${name}`}>
                  🗂 {name}
                </span>
              );
            })()}
            {!task.artifactsId && task.artifactsProduced && task.artifactsProduced.length > 0 && (
              <span className="text-[9px] bg-amber-500/10 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded font-semibold">
                {task.artifactsProduced.length} artifact{task.artifactsProduced.length !== 1 ? "s" : ""}
              </span>
            )}
            {task.deliverablesId && (() => {
              const name = deliverableSets.find(a => a.id === task.deliverablesId)?.title ?? `#${task.deliverablesId}`;
              return (
                <span className="text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded font-semibold" title={`Deliverable Set: ${name}`}>
                  📦 {name}
                </span>
              );
            })()}
            {!task.deliverablesId && task.clientDeliverables && task.clientDeliverables.length > 0 && (
              <span className="text-[9px] bg-green-500/10 text-green-400 border border-green-500/20 px-1.5 py-0.5 rounded font-semibold">
                {task.clientDeliverables.length} deliverable{task.clientDeliverables.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Always-visible action buttons */}
      <div className="flex items-center gap-1 flex-shrink-0">
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
                    className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
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
                    className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
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
                  className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                />
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

  // Two-column view: selected step
  const [selectedStepId, setSelectedStepId] = useState<number | null>(null);

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
      const res = await fetchWithAuth("/api/admin/workflow-templates");
      if (!res.ok) return;
      setTemplates(await res.json() as WorkflowTemplate[]);
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

  useEffect(() => {
    void fetchTemplates();
    void fetchServices();
    void fetchAssetLibrary();
  }, [fetchTemplates, fetchServices, fetchAssetLibrary]);

  const selectTemplate = useCallback(async (t: WorkflowTemplate) => {
    try {
      const res = await fetchWithAuth(`/api/admin/workflow-templates/${t.id}`);
      if (!res.ok) return;
      const data = await res.json() as WorkflowTemplate;
      setSelected(data);
      setDetailForm({ name: data.name, description: data.description ?? "", serviceId: data.serviceId });
      setSelectedStepId(null);
      setDrawerOpen(false);
      setAddingStep(false);
      setNewStepTitle("");
      setJsonImportOpen(false);
      setJsonImportText("");
      setEngImportOpen(false);
      setEngImportText("");
      setShowMissingOnly(false);
    } catch { /* ignore */ }
  }, [fetchWithAuth]);

  const refreshSelected = useCallback(async () => {
    if (!selected) return;
    try {
      const res = await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}`);
      if (!res.ok) return;
      const data = await res.json() as WorkflowTemplate;
      setSelected(data);
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
      const res = await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: detailForm.name, description: detailForm.description || null, serviceId: detailForm.serviceId }),
      });
      if (!res.ok) { toast({ title: "Failed to save", variant: "destructive" }); return; }
      toast({ title: "Template saved" });
      await fetchTemplates();
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
            }),
          }
        )
      )
    );
    await refreshSelected();
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

  const tasksMissingAssets = (selected?.steps ?? [])
    .flatMap(s => s.tasks ?? [])
    .filter(t => t.instructionSetId == null || t.checklistId == null || t.artifactsId == null || t.deliverablesId == null)
    .length;

  const stepMissingCounts = new Map<number, number>(
    steps.map(s => [
      s.id,
      (s.tasks ?? []).filter(t =>
        t.instructionSetId == null || t.checklistId == null ||
        t.artifactsId == null || t.deliverablesId == null
      ).length,
    ])
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
          <div className="p-8 text-center text-sm text-[#7D8590]">No templates yet.</div>
        ) : (
          <div className="divide-y divide-[#30363D] flex-1">
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => void selectTemplate(t)}
                className={`w-full text-left px-4 py-3.5 hover:bg-[#1C2128] transition-colors ${
                  selected?.id === t.id ? "bg-[#0078D4]/10 border-l-2 border-[#0078D4]" : ""
                }`}
              >
                <p className="font-medium text-sm text-[#E6EDF3] leading-snug truncate">{t.name}</p>
                {t.serviceId && (
                  <p className="text-xs text-[#7D8590] mt-0.5 truncate">
                    {services.find(s => s.id === t.serviceId)?.name ?? "Linked to service"}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      {!selected ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-[#7D8590]">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <p className="text-sm">Select or create a workflow template</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Template header */}
          <form onSubmit={saveTemplate} className="flex-shrink-0 border-b border-[#30363D] bg-[#161B22] px-5 py-3">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0 grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-[#7D8590] mb-0.5">Name</label>
                  <input
                    type="text"
                    value={detailForm.name}
                    required
                    onChange={e => setDetailForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full border border-[#30363D] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-[#7D8590] mb-0.5">Description</label>
                  <input
                    type="text"
                    value={detailForm.description}
                    onChange={e => setDetailForm(p => ({ ...p, description: e.target.value }))}
                    className="w-full border border-[#30363D] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-[#7D8590] mb-0.5">Default Service</label>
                  <select
                    value={detailForm.serviceId ?? ""}
                    onChange={e => setDetailForm(p => ({ ...p, serviceId: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full border border-[#30363D] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  >
                    <option value="">None</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleGenerateAssetSets}
                  disabled={generateDialogOpen || tasksMissingAssets === 0}
                  title={
                    tasksMissingAssets > 0
                      ? `Generate asset sets for ${tasksMissingAssets} task${tasksMissingAssets === 1 ? "" : "s"} missing sets`
                      : "All tasks already have asset sets linked"
                  }
                  className="flex items-center gap-1.5 text-xs text-purple-700 hover:text-purple-900 px-3 py-1.5 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {tasksMissingAssets === 0 ? (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Asset Sets Linked
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Generate Asset Sets
                      <span className="ml-0.5 text-[9px] bg-purple-500/15 text-purple-400 rounded-full px-1.5 py-0.5 font-semibold">{tasksMissingAssets}</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={deleteTemplate}
                  className="text-xs text-red-500 hover:text-red-400 px-3 py-1.5 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors"
                >
                  Delete
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-[#0078D4] text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </form>

          {/* Two-column body */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* ── Steps column ──────────────────────────────────────────── */}
            <div className="w-72 flex-shrink-0 border-r border-[#30363D] bg-[#161B22] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D] bg-[#161B22] flex-shrink-0">
                <h3 className="text-sm font-semibold text-[#E6EDF3]">
                  Steps
                  <span className="ml-1.5 text-[#7D8590] font-normal text-xs">({steps.length})</span>
                </h3>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e: DragEndEvent) => void handleStepDragEnd(e)}>
                  <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    {steps.map((step, idx) => (
                      <SortableStepCard
                        key={step.id}
                        step={step}
                        idx={idx}
                        totalSteps={steps.length}
                        isSelected={selectedStepId === step.id}
                        missingCount={stepMissingCounts.get(step.id) ?? 0}
                        onSelect={() => { setSelectedStepId(step.id); setShowMissingOnly(false); }}
                        onMoveUp={() => void moveStep(step, "up")}
                        onMoveDown={() => void moveStep(step, "down")}
                        onDelete={() => void deleteStep(step.id)}
                        onEditTitle={(id, title) => void saveStepTitle(id, title)}
                        onGenerateScripts={() => setGenerateScriptsStep(step)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>

                {steps.length === 0 && !addingStep && (
                  <p className="text-xs text-[#7D8590] italic text-center py-6">No steps yet.</p>
                )}

                {/* Bulk Tools expanded panels — rendered inside steps column */}
                {jsonImportOpen && (() => {
                  const { parsed, error } = parseTemplateSteps(jsonImportText);
                  return (
                    <div className="rounded-lg border border-cyan-200 bg-[#161B22] p-3 space-y-2 mt-2">
                      <p className="text-[10px] font-bold text-[#00B4D8] uppercase tracking-wide">Import from JSON</p>
                      <textarea
                        autoFocus
                        rows={7}
                        value={jsonImportText}
                        onChange={e => setJsonImportText(e.target.value)}
                        placeholder={`[\n  {\n    "title": "Discovery",\n    "tasks": [\n      { "title": "Review tenant", "groupName": "Engineer Tasks" }\n    ]\n  }\n]`}
                        className="w-full border border-[#30363D] rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-[#00B4D8] resize-y bg-[#161B22]"
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
                          className="bg-[#0A2540] text-white text-[10px] font-semibold px-3 py-1.5 rounded hover:bg-[#0A2540]/90 disabled:opacity-40 flex items-center gap-1"
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
                    <div className="rounded-lg border border-purple-200 bg-purple-50/60 p-3 space-y-2 mt-2">
                      <p className="text-[10px] font-bold text-purple-700 uppercase tracking-wide">Import Engineer Fields</p>
                      <p className="text-[9px] text-purple-500">Paste tasks by title. Only the 4 engineer fields are updated.</p>
                      <textarea
                        autoFocus
                        rows={7}
                        value={engImportText}
                        onChange={e => setEngImportText(e.target.value)}
                        placeholder={`[\n  {\n    "title": "Review tenant",\n    "instructions": ["Log into admin"],\n    "checklist": [{ "id": "c1", "label": "Done" }]\n  }\n]`}
                        className="w-full border border-purple-200 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-purple-400 resize-y bg-[#161B22]"
                      />
                      {engImportText.trim() && error && (
                        <p className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1 font-mono">{error}</p>
                      )}
                      {parsed && parsed.length > 0 && (
                        <p className="text-[10px] text-purple-600">
                          {matchCount} will update{skipCount > 0 && <span className="text-amber-500 ml-1">· {skipCount} not matched</span>}
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
              </div>

              {/* Add step */}
              <div className="flex-shrink-0 p-3 border-t border-[#30363D] bg-[#161B22]">
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
                      className="w-full border border-[#30363D] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
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
                    className="w-full bg-[#0078D4] text-white text-xs font-semibold py-2 rounded-lg hover:bg-[#006CBE] transition-colors flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Step
                  </button>
                )}

                {/* Bulk Tools */}
                <div className="mt-3">
                  <button
                    onClick={() => setBulkOpen(v => !v)}
                    className="w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-[#7D8590] hover:text-[#7D8590] py-1"
                  >
                    <span>Bulk Tools</span>
                    <svg className={`w-3 h-3 transition-transform ${bulkOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {bulkOpen && (
                    <div className="mt-2 space-y-1">
                      <button
                        onClick={exportToJson}
                        className="w-full flex items-center gap-1.5 text-xs text-[#7D8590] hover:text-[#0078D4] px-2 py-1.5 rounded hover:bg-[#1C2128]"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8v-2a2 2 0 00-2-2H5a2 2 0 00-2 2v2M9 12l3-3 3 3M12 21V9" />
                        </svg>
                        Export JSON
                      </button>
                      <button
                        onClick={() => { setEngImportOpen(v => !v); setJsonImportOpen(false); setEngImportText(""); }}
                        className="w-full flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 px-2 py-1.5 rounded hover:bg-purple-50"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        Import Engineer Fields
                      </button>
                      <button
                        onClick={() => { setJsonImportOpen(v => !v); setEngImportOpen(false); setJsonImportText(""); }}
                        className="w-full flex items-center gap-1.5 text-xs text-[#00B4D8] hover:text-[#0097B5] px-2 py-1.5 rounded hover:bg-cyan-50"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2M9 12l3 3 3-3M12 3v12" />
                        </svg>
                        Import from JSON
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Task panel ────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#161B22]">
              {!selectedStep ? (
                <div className="flex-1 flex items-center justify-center text-[#7D8590]">
                  <div className="text-center">
                    <svg className="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
                    </svg>
                    <p className="text-sm">Select a step to manage its tasks</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Task panel header */}
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#30363D] flex-shrink-0">
                    <div>
                      <h3 className="font-semibold text-[#E6EDF3] text-sm">{selectedStep.title}</h3>
                      <p className="text-xs text-[#7D8590] mt-0.5">
                        {showMissingOnly
                          ? `${stepTasks.length} of ${allStepTasks.length} task${allStepTasks.length !== 1 ? "s" : ""} missing sets`
                          : `${allStepTasks.length} task${allStepTasks.length !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                    {stepMissingCount > 0 && (
                      <button
                        onClick={() => setShowMissingOnly(v => !v)}
                        className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                          showMissingOnly
                            ? "bg-amber-500/100 text-white border-amber-500 hover:bg-amber-600"
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
                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    {stepTasks.length === 0 && (
                      showMissingOnly
                        ? (
                          <div className="flex flex-col items-center gap-2 py-10 text-center">
                            <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-sm font-medium text-green-400">All tasks in this step have asset sets linked.</p>
                            <button onClick={() => setShowMissingOnly(false)} className="text-xs text-[#7D8590] hover:text-[#7D8590] underline">Show all tasks</button>
                          </div>
                        )
                        : <p className="text-xs text-[#7D8590] italic text-center py-8">No tasks yet for this step.</p>
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
                                    instructionSets={instructionSets}
                                    checklists={checklists}
                                    artifactSets={artifactSets}
                                    deliverableSets={deliverableSets}
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
                  <div className="flex-shrink-0 px-5 py-4 border-t border-[#30363D]">
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
