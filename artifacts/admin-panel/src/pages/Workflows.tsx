import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
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
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
        <button type="button" onClick={addItem} className="text-[9px] font-semibold text-[#0078D4] hover:underline">
          + Add
        </button>
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="flex flex-col gap-0.5 flex-shrink-0">
              <button type="button" onClick={() => moveUp(i)} disabled={i === 0}
                className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20 leading-none">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button type="button" onClick={() => moveDown(i)} disabled={i === items.length - 1}
                className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20 leading-none">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            <input
              value={item}
              placeholder={placeholder ?? "Enter item…"}
              onChange={e => updateItem(i, e.target.value)}
              className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
            />
            <button type="button" onClick={() => removeItem(i)} className="flex-shrink-0 p-1 text-gray-300 hover:text-red-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="text-[10px] text-gray-400 italic">No items yet.</p>}
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
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Checklist</span>
        <button type="button" onClick={addItem} className="text-[9px] font-semibold text-[#0078D4] hover:underline">
          + Add item
        </button>
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={item.id} className="flex items-center gap-1">
            <div className="flex flex-col gap-0.5 flex-shrink-0">
              <button type="button" onClick={() => moveUp(i)} disabled={i === 0}
                className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20 leading-none">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button type="button" onClick={() => moveDown(i)} disabled={i === items.length - 1}
                className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20 leading-none">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            <span className="flex-shrink-0 w-3.5 h-3.5 rounded border border-gray-300 bg-white" />
            <input
              value={item.label}
              placeholder="Checklist item…"
              onChange={e => updateLabel(item.id, e.target.value)}
              className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
            />
            <button type="button" onClick={() => removeItem(item.id)} className="flex-shrink-0 p-1 text-gray-300 hover:text-red-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="text-[10px] text-gray-400 italic">No checklist items yet.</p>}
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
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
  onEditTitle,
}: {
  step: WorkflowStep;
  idx: number;
  totalSteps: number;
  isSelected: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onEditTitle: (id: number, title: string) => void;
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
          isSelected ? "bg-blue-50 border-[#0078D4]" : "bg-white border-[#0078D4]"
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
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
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
          ? "bg-blue-50 border-[#0078D4] shadow-sm"
          : "bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50"
      }`}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="flex-shrink-0 p-0.5 text-gray-300 hover:text-gray-400 cursor-grab active:cursor-grabbing"
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
        isSelected ? "bg-[#0078D4] text-white" : "bg-gray-100 text-gray-500"
      }`}>
        {idx + 1}
      </div>

      {/* Title + task count */}
      <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
        <span className="text-sm font-medium text-[#0A2540] truncate block leading-snug">{step.title}</span>
        {taskCount > 0 && (
          <span className="flex-shrink-0 text-[10px] text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">
            {taskCount}
          </span>
        )}
      </div>

      {/* Action buttons — always visible */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={startEdit}
          className="p-1 text-gray-400 hover:text-[#0078D4] rounded"
          title="Rename step"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button
          onClick={e => { e.stopPropagation(); onMoveUp(); }}
          disabled={idx === 0}
          className="p-1 text-gray-300 hover:text-gray-500 disabled:opacity-20 rounded"
          title="Move up"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          onClick={e => { e.stopPropagation(); onMoveDown(); }}
          disabled={idx === totalSteps - 1}
          className="p-1 text-gray-300 hover:text-gray-500 disabled:opacity-20 rounded"
          title="Move down"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="p-1 text-gray-300 hover:text-red-500 rounded"
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2.5 hover:border-[#0078D4] hover:bg-blue-50 cursor-pointer transition-colors"
      onClick={() => onEdit(task)}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="flex-shrink-0 p-0.5 text-gray-300 hover:text-gray-400 cursor-grab active:cursor-grabbing"
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
        <span className="text-sm text-[#0A2540] leading-snug">{task.title}</span>
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
              <span className="text-[9px] bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded font-semibold">
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
              <span className="text-[9px] bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded font-semibold">
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
              <span className="text-[9px] bg-green-50 text-green-600 border border-green-100 px-1.5 py-0.5 rounded font-semibold">
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
          className="p-1.5 text-gray-400 hover:text-[#0078D4] rounded hover:bg-blue-50"
          title="Edit task"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button
          onClick={() => onDelete(task)}
          className="p-1.5 text-gray-400 hover:text-red-500 rounded hover:bg-red-50"
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
        className={`fixed top-0 right-0 h-full w-[480px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <h3 className="font-semibold text-[#0A2540] text-base">
            {isNew ? "Add Task" : "Edit Task"}
          </h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-5 flex-shrink-0">
          {(["basic", "assets", "inline"] as DrawerTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px ${
                tab === t
                  ? "border-[#0078D4] text-[#0078D4]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
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
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Title *</label>
                <input
                  autoFocus
                  type="text"
                  value={form.title}
                  placeholder="Task title"
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Group</label>
                  <select
                    value={form.groupName}
                    onChange={e => setForm(p => ({ ...p, groupName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  >
                    <option value="">No group</option>
                    {GROUP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Type</label>
                  <select
                    value={form.taskType}
                    onChange={e => setForm(p => ({ ...p, taskType: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  >
                    <option value="">No type</option>
                    {TASK_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Description</label>
                <textarea
                  value={form.description}
                  placeholder="Optional description…"
                  rows={4}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
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
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Instruction Set</label>
                <select
                  value={form.instructionSetId ?? ""}
                  onChange={e => setForm(p => ({ ...p, instructionSetId: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                >
                  <option value="">None (use inline)</option>
                  {instructionSets.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Checklist</label>
                <select
                  value={form.checklistId ?? ""}
                  onChange={e => setForm(p => ({ ...p, checklistId: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                >
                  <option value="">None (use inline)</option>
                  {checklists.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Artifact Set</label>
                <select
                  value={form.artifactsId ?? ""}
                  onChange={e => setForm(p => ({ ...p, artifactsId: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                >
                  <option value="">None (use inline)</option>
                  {artifactSets.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Deliverable Set</label>
                <select
                  value={form.deliverablesId ?? ""}
                  onChange={e => setForm(p => ({ ...p, deliverablesId: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
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
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200 flex-shrink-0 bg-gray-50">
          <button
            onClick={onClose}
            className="text-sm text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 font-medium"
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

  // Bulk Tools
  const [bulkOpen, setBulkOpen] = useState(false);
  const [jsonImportOpen, setJsonImportOpen] = useState(false);

  // AI asset generation
  const [generating, setGenerating] = useState(false);
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

  async function handleGenerateAssetSets() {
    if (!selected || generating) return;
    setGenerating(true);
    try {
      const res = await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/generate-asset-sets`, { method: "POST" });
      const data = await res.json() as { processed?: number; setsCreated?: number; error?: string };
      if (!res.ok) {
        toast({ title: "Generation failed", description: data.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      if (data.processed === 0) {
        toast({ title: "Nothing to generate", description: "All tasks already have asset sets linked." });
      } else {
        const failedCount = (data as { failed?: number }).failed ?? 0;
        toast({
          title: failedCount > 0 ? "Asset sets generated (with errors)" : "Asset sets generated",
          description: [
            `Processed ${data.processed} task${data.processed === 1 ? "" : "s"}, created ${data.setsCreated} set${data.setsCreated === 1 ? "" : "s"}.`,
            failedCount > 0 ? `${failedCount} task${failedCount === 1 ? "" : "s"} failed to generate.` : "",
          ].filter(Boolean).join(" "),
          variant: failedCount > 0 ? "destructive" : "default",
        });
        await Promise.all([fetchTemplates(), refreshSelected()]);
      }
    } catch {
      toast({ title: "Generation failed", description: "Network error", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const steps = (selected?.steps ?? []).slice().sort((a, b) => a.order - b.order);
  const selectedStep = steps.find(s => s.id === selectedStepId) ?? null;
  const stepTasks = (selectedStep?.tasks ?? []).slice().sort((a, b) => a.order - b.order);

  const tasksMissingAssets = (selected?.steps ?? [])
    .flatMap(s => s.tasks ?? [])
    .filter(t => t.instructionSetId == null || t.checklistId == null || t.artifactsId == null || t.deliverablesId == null)
    .length;

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
      <div className="w-64 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-[#0A2540] text-sm">Workflow Templates</h2>
            <p className="text-xs text-gray-500 mt-0.5">{templates.length} templates</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void handleExportAllTemplates()}
              disabled={templates.length === 0}
              title="Download all templates as JSON"
              className="flex items-center gap-1 text-xs text-gray-600 hover:text-[#0078D4] px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-[#0078D4] hover:bg-blue-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : templates.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No templates yet.</div>
        ) : (
          <div className="divide-y divide-gray-100 flex-1">
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => void selectTemplate(t)}
                className={`w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors ${
                  selected?.id === t.id ? "bg-blue-50 border-l-2 border-[#0078D4]" : ""
                }`}
              >
                <p className="font-medium text-sm text-[#0A2540] leading-snug truncate">{t.name}</p>
                {t.serviceId && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
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
          <div className="text-center text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <p className="text-sm">Select or create a workflow template</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Template header */}
          <form onSubmit={saveTemplate} className="flex-shrink-0 border-b border-gray-200 bg-white px-5 py-3">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0 grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-0.5">Name</label>
                  <input
                    type="text"
                    value={detailForm.name}
                    required
                    onChange={e => setDetailForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-0.5">Description</label>
                  <input
                    type="text"
                    value={detailForm.description}
                    onChange={e => setDetailForm(p => ({ ...p, description: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-0.5">Default Service</label>
                  <select
                    value={detailForm.serviceId ?? ""}
                    onChange={e => setDetailForm(p => ({ ...p, serviceId: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  >
                    <option value="">None</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {tasksMissingAssets > 0 && (
                  <button
                    type="button"
                    onClick={handleGenerateAssetSets}
                    disabled={generating}
                    title={`Generate asset sets for ${tasksMissingAssets} task${tasksMissingAssets === 1 ? "" : "s"} missing sets`}
                    className="flex items-center gap-1.5 text-xs text-purple-700 hover:text-purple-900 px-3 py-1.5 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors disabled:opacity-60"
                  >
                    {generating ? (
                      <>
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Generating…
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Generate Asset Sets
                        <span className="ml-0.5 text-[9px] bg-purple-100 text-purple-700 rounded-full px-1.5 py-0.5 font-semibold">{tasksMissingAssets}</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={deleteTemplate}
                  className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
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
            <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
                <h3 className="text-sm font-semibold text-[#0A2540]">
                  Steps
                  <span className="ml-1.5 text-gray-400 font-normal text-xs">({steps.length})</span>
                </h3>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => void handleStepDragEnd(e)}>
                  <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    {steps.map((step, idx) => (
                      <SortableStepCard
                        key={step.id}
                        step={step}
                        idx={idx}
                        totalSteps={steps.length}
                        isSelected={selectedStepId === step.id}
                        onSelect={() => setSelectedStepId(step.id)}
                        onMoveUp={() => void moveStep(step, "up")}
                        onMoveDown={() => void moveStep(step, "down")}
                        onDelete={() => void deleteStep(step.id)}
                        onEditTitle={(id, title) => void saveStepTitle(id, title)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>

                {steps.length === 0 && !addingStep && (
                  <p className="text-xs text-gray-400 italic text-center py-6">No steps yet.</p>
                )}

                {/* Bulk Tools expanded panels — rendered inside steps column */}
                {jsonImportOpen && (() => {
                  const { parsed, error } = parseTemplateSteps(jsonImportText);
                  return (
                    <div className="rounded-lg border border-cyan-200 bg-gray-50 p-3 space-y-2 mt-2">
                      <p className="text-[10px] font-bold text-[#00B4D8] uppercase tracking-wide">Import from JSON</p>
                      <textarea
                        autoFocus
                        rows={7}
                        value={jsonImportText}
                        onChange={e => setJsonImportText(e.target.value)}
                        placeholder={`[\n  {\n    "title": "Discovery",\n    "tasks": [\n      { "title": "Review tenant", "groupName": "Engineer Tasks" }\n    ]\n  }\n]`}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-[#00B4D8] resize-y bg-white"
                      />
                      {jsonImportText.trim() && error && (
                        <p className="text-[10px] text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1 font-mono">{error}</p>
                      )}
                      {parsed && parsed.length > 0 && (
                        <p className="text-[10px] text-gray-500">
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
                          className="text-[10px] font-medium px-2 py-1.5 rounded hover:bg-gray-200 text-gray-600">
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
                        className="w-full border border-purple-200 rounded px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-purple-400 resize-y bg-white"
                      />
                      {engImportText.trim() && error && (
                        <p className="text-[10px] text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1 font-mono">{error}</p>
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
                          className="text-[10px] font-medium px-2 py-1.5 rounded hover:bg-gray-200 text-gray-600">
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Add step */}
              <div className="flex-shrink-0 p-3 border-t border-gray-200 bg-white">
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
                      className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
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
                        className="text-xs text-gray-500 px-3 py-1.5 hover:text-gray-700"
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
                    className="w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-gray-400 hover:text-gray-600 py-1"
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
                        className="w-full flex items-center gap-1.5 text-xs text-gray-600 hover:text-[#0078D4] px-2 py-1.5 rounded hover:bg-gray-100"
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
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white">
              {!selectedStep ? (
                <div className="flex-1 flex items-center justify-center text-gray-400">
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
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 flex-shrink-0">
                    <div>
                      <h3 className="font-semibold text-[#0A2540] text-sm">{selectedStep.title}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {stepTasks.length} task{stepTasks.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>

                  {/* Task list */}
                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    {stepTasks.length === 0 && (
                      <p className="text-xs text-gray-400 italic text-center py-8">No tasks yet for this step.</p>
                    )}

                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => void handleTaskDragEnd(e)}>
                      <SortableContext items={stepTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                        {renderedGroups.length > 0 ? (
                          renderedGroups.map(group => (
                            <div key={group}>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{group}</span>
                                <div className="flex-1 h-px bg-gray-100" />
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
                  <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100">
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
    </div>
  );
}
