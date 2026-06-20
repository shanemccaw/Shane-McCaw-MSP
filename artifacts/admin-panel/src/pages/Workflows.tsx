import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

const GROUP_OPTIONS = ["Engineer Tasks", "Artifacts Produced", "Client Deliverables"] as const;
type GroupOption = typeof GROUP_OPTIONS[number];

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
        <button
          type="button"
          onClick={addItem}
          className="text-[9px] font-semibold text-[#0078D4] hover:underline"
        >
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
            <button type="button" onClick={() => removeItem(i)}
              className="flex-shrink-0 p-1 text-gray-300 hover:text-red-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-[10px] text-gray-400 italic">No items yet.</p>
        )}
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
        <button type="button" onClick={addItem}
          className="text-[9px] font-semibold text-[#0078D4] hover:underline">
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
            <button type="button" onClick={() => removeItem(item.id)}
              className="flex-shrink-0 p-1 text-gray-300 hover:text-red-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-[10px] text-gray-400 italic">No checklist items yet.</p>
        )}
      </div>
    </div>
  );
}

interface EditingTaskForm {
  title: string;
  groupName: string;
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

function TaskCard({
  task,
  templateId,
  onEdit,
  onDelete,
  editingTask,
  editingTaskForm,
  setEditingTaskForm,
  onSaveTask,
  onCancelEdit,
  instructionSets,
  checklists,
  artifactSets,
  deliverableSets,
}: {
  task: StepTask;
  templateId: number;
  onEdit: (t: StepTask) => void;
  onDelete: (t: StepTask) => void;
  editingTask: StepTask | null;
  editingTaskForm: EditingTaskForm;
  setEditingTaskForm: React.Dispatch<React.SetStateAction<EditingTaskForm>>;
  onSaveTask: () => void;
  onCancelEdit: () => void;
  instructionSets: AssetItem[];
  checklists: AssetItem[];
  artifactSets: AssetItem[];
  deliverableSets: AssetItem[];
}) {
  const [engineerOpen, setEngineerOpen] = useState(false);

  if (editingTask?.id === task.id) {
    return (
      <div className="bg-white rounded-lg border border-[#0078D4] p-3 space-y-3">
        <div className="space-y-2">
          <input
            type="text"
            value={editingTaskForm.title}
            placeholder="Task title"
            autoFocus
            onChange={e => setEditingTaskForm(p => ({ ...p, title: e.target.value }))}
            onKeyDown={e => { if (e.key === "Escape") onCancelEdit(); }}
            className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
          />
          <select
            value={editingTaskForm.groupName}
            onChange={e => setEditingTaskForm(p => ({ ...p, groupName: e.target.value }))}
            className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
          >
            <option value="">No group</option>
            {GROUP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        {/* Asset library links */}
        <div className="border-t border-gray-100 pt-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 mb-2">Link from Asset Library</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Instruction Set</label>
              <select
                value={editingTaskForm.instructionSetId ?? ""}
                onChange={e => setEditingTaskForm(p => ({ ...p, instructionSetId: e.target.value ? Number(e.target.value) : null }))}
                className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="">None (use inline)</option>
                {instructionSets.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Checklist</label>
              <select
                value={editingTaskForm.checklistId ?? ""}
                onChange={e => setEditingTaskForm(p => ({ ...p, checklistId: e.target.value ? Number(e.target.value) : null }))}
                className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="">None (use inline)</option>
                {checklists.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Artifact Set</label>
              <select
                value={editingTaskForm.artifactsId ?? ""}
                onChange={e => setEditingTaskForm(p => ({ ...p, artifactsId: e.target.value ? Number(e.target.value) : null }))}
                className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="">None (use inline)</option>
                {artifactSets.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Deliverable Set</label>
              <select
                value={editingTaskForm.deliverablesId ?? ""}
                onChange={e => setEditingTaskForm(p => ({ ...p, deliverablesId: e.target.value ? Number(e.target.value) : null }))}
                className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="">None (use inline)</option>
                {deliverableSets.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
          </div>
          <p className="text-[9px] text-indigo-400 mt-1.5">Library links override inline fields when the task is instantiated.</p>
        </div>

        {/* Engineer detail sections */}
        <button
          type="button"
          onClick={() => setEngineerOpen(v => !v)}
          className="w-full flex items-center justify-between text-[10px] font-semibold text-[#0078D4] hover:text-[#006CBE] py-1 border-t border-gray-100"
        >
          <span>Inline Engineer Detail Fields</span>
          <svg className={`w-3 h-3 transition-transform ${engineerOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {engineerOpen && (
          <div className="space-y-4 bg-gray-50 rounded-lg p-3 border border-gray-200">
            <StringListEditor
              label="Instructions"
              items={editingTaskForm.instructions}
              onChange={items => setEditingTaskForm(p => ({ ...p, instructions: items }))}
              placeholder="Step-by-step instruction…"
            />
            <ChecklistEditor
              items={editingTaskForm.checklist}
              onChange={items => setEditingTaskForm(p => ({ ...p, checklist: items }))}
            />
            <StringListEditor
              label="Artifacts Produced"
              items={editingTaskForm.artifactsProduced}
              onChange={items => setEditingTaskForm(p => ({ ...p, artifactsProduced: items }))}
              placeholder="E.g. Gap Analysis Report"
            />
            <StringListEditor
              label="Client Deliverables"
              items={editingTaskForm.clientDeliverables}
              onChange={items => setEditingTaskForm(p => ({ ...p, clientDeliverables: items }))}
              placeholder="E.g. Executive Roadmap"
            />
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onSaveTask} className="text-xs bg-[#0078D4] text-white px-3 py-1.5 rounded font-medium hover:bg-[#006CBE]">Save</button>
          <button onClick={onCancelEdit} className="text-xs text-gray-500 px-3 py-1.5">Cancel</button>
        </div>
      </div>
    );
  }

  const hasInlineDetail =
    (task.instructions && task.instructions.length > 0) ||
    (task.checklist && task.checklist.length > 0) ||
    (task.artifactsProduced && task.artifactsProduced.length > 0) ||
    (task.clientDeliverables && task.clientDeliverables.length > 0);
  const hasLibraryLinks = task.instructionSetId || task.checklistId || task.artifactsId || task.deliverablesId;

  return (
    <div className="flex items-start gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2 group/task">
      <svg className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
      <div className="flex-1 min-w-0">
        <span className="text-sm text-[#0A2540] leading-snug">{task.title}</span>
        {(hasInlineDetail || hasLibraryLinks) && (
          <div className="flex flex-wrap gap-1 mt-1">
            {task.instructionSetId && (
              <span className="text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded font-semibold">
                📚 instructions
              </span>
            )}
            {!task.instructionSetId && task.instructions && task.instructions.length > 0 && (
              <span className="text-[9px] bg-purple-50 text-purple-600 border border-purple-100 px-1.5 py-0.5 rounded font-semibold">
                {task.instructions.length} instruction{task.instructions.length !== 1 ? "s" : ""}
              </span>
            )}
            {task.checklistId && (
              <span className="text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded font-semibold">
                📚 checklist
              </span>
            )}
            {!task.checklistId && task.checklist && task.checklist.length > 0 && (
              <span className="text-[9px] bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded font-semibold">
                {task.checklist.length} checklist item{task.checklist.length !== 1 ? "s" : ""}
              </span>
            )}
            {task.artifactsId && (
              <span className="text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded font-semibold">
                📚 artifacts
              </span>
            )}
            {!task.artifactsId && task.artifactsProduced && task.artifactsProduced.length > 0 && (
              <span className="text-[9px] bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded font-semibold">
                {task.artifactsProduced.length} artifact{task.artifactsProduced.length !== 1 ? "s" : ""}
              </span>
            )}
            {task.deliverablesId && (
              <span className="text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded font-semibold">
                📚 deliverables
              </span>
            )}
            {!task.deliverablesId && task.clientDeliverables && task.clientDeliverables.length > 0 && (
              <span className="text-[9px] bg-green-50 text-green-600 border border-green-100 px-1.5 py-0.5 rounded font-semibold">
                {task.clientDeliverables.length} deliverable{task.clientDeliverables.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="hidden group-hover/task:flex items-center gap-1 flex-shrink-0">
        <button onClick={() => onEdit(task)} className="p-1 text-gray-400 hover:text-[#0078D4]">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button onClick={() => onDelete(task)} className="p-1 text-gray-400 hover:text-red-500">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const EMPTY_TASK_FORM: EditingTaskForm = {
  title: "",
  groupName: "",
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

export default function WorkflowsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selected, setSelected] = useState<WorkflowTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detailForm, setDetailForm] = useState<{ name: string; description: string; serviceId: number | null }>({ name: "", description: "", serviceId: null });

  // Asset library state for FK dropdowns
  const [instructionSets, setInstructionSets] = useState<AssetItem[]>([]);
  const [checklists, setChecklists] = useState<AssetItem[]>([]);
  const [artifactSets, setArtifactSets] = useState<AssetItem[]>([]);
  const [deliverableSets, setDeliverableSets] = useState<AssetItem[]>([]);

  // Step state
  const [newStep, setNewStep] = useState<{ title: string; description: string } | null>(null);
  const [editingStep, setEditingStep] = useState<WorkflowStep | null>(null);
  const [editingStepForm, setEditingStepForm] = useState({ title: "", description: "" });
  const [expandedStepIds, setExpandedStepIds] = useState<Set<number>>(new Set());

  // JSON import state
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [jsonImportText, setJsonImportText] = useState("");
  const [jsonImporting, setJsonImporting] = useState(false);

  // Engineer-fields import state
  const [engImportOpen, setEngImportOpen] = useState(false);
  const [engImportText, setEngImportText] = useState("");
  const [engImporting, setEngImporting] = useState(false);

  // Task state
  const [newTask, setNewTask] = useState<{ stepId: number; title: string; groupName: string; description: string } | null>(null);
  const [editingTask, setEditingTask] = useState<StepTask | null>(null);
  const [editingTaskForm, setEditingTaskForm] = useState<EditingTaskForm>(EMPTY_TASK_FORM);

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
      setExpandedStepIds(new Set());
      setEditingStep(null);
      setEditingTask(null);
      setNewTask(null);
      setNewStep(null);
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

  type ImportTask = { title: string; groupName?: string; description?: string; instructions?: string[]; checklist?: ChecklistItem[]; artifactsProduced?: string[]; clientDeliverables?: string[] };
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

  // ── Engineer-fields-only import ────────────────────────────────────────────
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
      // Build a flat lookup: normalised title → all matching tasks
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

  async function addStep() {
    if (!selected || !newStep?.title.trim()) return;
    const maxOrder = (selected.steps ?? []).reduce((m, s) => Math.max(m, s.order), -1);
    const res = await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/steps`, {
      method: "POST",
      body: JSON.stringify({ title: newStep.title, description: newStep.description || null, order: maxOrder + 1 }),
    });
    if (!res.ok) { toast({ title: "Failed to add step", variant: "destructive" }); return; }
    setNewStep(null);
    await refreshSelected();
  }

  async function saveStep() {
    if (!selected || !editingStep) return;
    const res = await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/steps/${editingStep.id}`, {
      method: "PUT",
      body: JSON.stringify({ title: editingStepForm.title, description: editingStepForm.description || null, order: editingStep.order }),
    });
    if (!res.ok) { toast({ title: "Failed to save step", variant: "destructive" }); return; }
    setEditingStep(null);
    await refreshSelected();
  }

  async function deleteStep(stepId: number) {
    if (!selected) return;
    await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/steps/${stepId}`, { method: "DELETE" });
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

  function toggleStep(stepId: number) {
    setExpandedStepIds(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }

  async function addTask() {
    if (!selected || !newTask || !newTask.title.trim()) return;
    const res = await fetchWithAuth(
      `/api/admin/workflow-templates/${selected.id}/steps/${newTask.stepId}/tasks`,
      {
        method: "POST",
        body: JSON.stringify({ title: newTask.title, description: newTask.description || null, groupName: newTask.groupName || null, order: 0 }),
      }
    );
    if (!res.ok) { toast({ title: "Failed to add task", variant: "destructive" }); return; }
    setNewTask(null);
    await refreshSelected();
  }

  async function saveTask() {
    if (!selected || !editingTask) return;
    const res = await fetchWithAuth(
      `/api/admin/workflow-templates/${selected.id}/steps/${editingTask.workflowTemplateStepId}/tasks/${editingTask.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          title: editingTaskForm.title,
          description: editingTaskForm.description || null,
          groupName: editingTaskForm.groupName || null,
          order: editingTask.order,
          instructions: editingTaskForm.instructions.filter(Boolean).length > 0 ? editingTaskForm.instructions.filter(Boolean) : null,
          checklist: editingTaskForm.checklist.filter(c => c.label.trim()).length > 0 ? editingTaskForm.checklist.filter(c => c.label.trim()) : null,
          artifactsProduced: editingTaskForm.artifactsProduced.filter(Boolean).length > 0 ? editingTaskForm.artifactsProduced.filter(Boolean) : null,
          clientDeliverables: editingTaskForm.clientDeliverables.filter(Boolean).length > 0 ? editingTaskForm.clientDeliverables.filter(Boolean) : null,
          instructionSetId: editingTaskForm.instructionSetId,
          checklistId: editingTaskForm.checklistId,
          artifactsId: editingTaskForm.artifactsId,
          deliverablesId: editingTaskForm.deliverablesId,
        }),
      }
    );
    if (!res.ok) { toast({ title: "Failed to save task", variant: "destructive" }); return; }
    setEditingTask(null);
    await refreshSelected();
  }

  async function deleteTask(task: StepTask) {
    if (!selected) return;
    await fetchWithAuth(
      `/api/admin/workflow-templates/${selected.id}/steps/${task.workflowTemplateStepId}/tasks/${task.id}`,
      { method: "DELETE" }
    );
    await refreshSelected();
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

  const steps = (selected?.steps ?? []).slice().sort((a, b) => a.order - b.order);

  return (
    <div className="flex h-full">
      {/* Template list sidebar */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-[#0A2540] text-sm">Workflow Templates</h2>
            <p className="text-xs text-gray-500 mt-0.5">{templates.length} templates</p>
          </div>
          <button onClick={createTemplate} disabled={saving}
            className="bg-[#0078D4] text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60">
            + New
          </button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : templates.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No templates yet.</div>
        ) : (
          <div className="divide-y divide-gray-100 flex-1">
            {templates.map(t => (
              <button key={t.id} onClick={() => void selectTemplate(t)}
                className={`w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors ${selected?.id === t.id ? "bg-blue-50 border-l-2 border-[#0078D4]" : ""}`}>
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

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <p className="text-sm">Select or create a workflow template</p>
            </div>
          </div>
        ) : (
          <div className="p-6 max-w-3xl">
            {/* Template metadata */}
            <form onSubmit={saveTemplate} className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[#0A2540]">Template Details</h3>
                <div className="flex gap-2">
                  <button type="button" onClick={deleteTemplate}
                    className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">
                    Delete
                  </button>
                  <button type="submit" disabled={saving}
                    className="bg-[#0078D4] text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60">
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Name</label>
                  <input type="text" value={detailForm.name} required
                    onChange={e => setDetailForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Description</label>
                  <input type="text" value={detailForm.description}
                    onChange={e => setDetailForm(p => ({ ...p, description: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                    placeholder="Optional description" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Default Service</label>
                  <select value={detailForm.serviceId ?? ""}
                    onChange={e => setDetailForm(p => ({ ...p, serviceId: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]">
                    <option value="">None</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
            </form>

            {/* Steps with inline task management */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-[#0A2540]">
                  Steps <span className="text-gray-400 font-normal text-sm">({steps.length})</span>
                </h3>
                <div className="flex items-center gap-4">
                  <button
                    onClick={exportToJson}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#0078D4] hover:underline font-medium">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 8v-2a2 2 0 00-2-2H5a2 2 0 00-2 2v2M9 12l3-3 3 3M12 21V9" />
                    </svg>
                    Export JSON
                  </button>
                  <button
                    onClick={() => { setEngImportOpen(v => !v); setEngImportText(""); setJsonImportOpen(false); setNewStep(null); }}
                    className="flex items-center gap-1 text-xs text-purple-600 hover:underline font-medium">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                    Import Engineer Fields
                  </button>
                  <button
                    onClick={() => { setJsonImportOpen(v => !v); setJsonImportText(""); setEngImportOpen(false); setNewStep(null); }}
                    className="flex items-center gap-1 text-xs text-[#00B4D8] hover:underline font-medium">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2M9 12l3 3 3-3M12 3v12" />
                    </svg>
                    Import from JSON
                  </button>
                  <button onClick={() => { setNewStep({ title: "", description: "" }); setJsonImportOpen(false); setEngImportOpen(false); }}
                    className="text-xs text-[#0078D4] hover:underline font-medium">
                    + Add step
                  </button>
                </div>
              </div>

              {jsonImportOpen && (() => {
                const { parsed, error } = parseTemplateSteps(jsonImportText);
                return (
                  <div className="px-5 py-4 border-b border-gray-100 space-y-3 bg-gray-50">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Paste JSON array of steps</label>
                      <textarea
                        autoFocus
                        rows={10}
                        value={jsonImportText}
                        onChange={e => setJsonImportText(e.target.value)}
                        placeholder={`[\n  {\n    "title": "Discovery & Assessment",\n    "description": "Review current M365 environment",\n    "tasks": [\n      { "title": "Review tenant configuration", "groupName": "Engineer Tasks", "instructions": ["Log in to M365 admin", "Check license usage"] },\n      { "title": "Health Assessment Report", "groupName": "Artifacts Produced" },\n      { "title": "Gap Analysis Document", "groupName": "Client Deliverables" }\n    ]\n  }\n]`}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#00B4D8] resize-y bg-white"
                      />
                    </div>
                    {jsonImportText.trim() && error && (
                      <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5 font-mono">{error}</p>
                    )}
                    {parsed && parsed.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                          {parsed.length} step{parsed.length !== 1 ? "s" : ""}
                          {parsed.reduce((n, s) => n + (s.tasks?.length ?? 0), 0) > 0 && (
                            <> · {parsed.reduce((n, s) => n + (s.tasks?.length ?? 0), 0)} task{parsed.reduce((n, s) => n + (s.tasks?.length ?? 0), 0) !== 1 ? "s" : ""}</>
                          )}
                        </p>
                        {parsed.map((s, i) => {
                          const groupedTasks = (s.tasks ?? []).reduce<Record<string, typeof s.tasks>>((acc, t) => {
                            const g = t.groupName ?? "Tasks";
                            acc[g] = [...(acc[g] ?? []), t];
                            return acc;
                          }, {});
                          return (
                            <div key={i} className="border border-gray-100 rounded-lg overflow-hidden">
                              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                                <span className="w-5 h-5 rounded-full bg-[#0078D4]/10 text-[#0078D4] text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-[#0A2540] leading-snug">{s.title}</p>
                                  {s.description && <p className="text-[10px] text-gray-400 leading-snug">{s.description}</p>}
                                </div>
                              </div>
                              {Object.entries(groupedTasks).map(([group, tasks]) => (
                                <div key={group} className="border-t border-gray-100">
                                  <p className="px-3 pt-1.5 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-[#00B4D8]">{group}</p>
                                  {tasks!.map((t, j) => (
                                    <div key={j} className="flex items-start gap-2 px-3 py-1">
                                      <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 flex-shrink-0" />
                                      <div className="min-w-0">
                                        <p className="text-[11px] text-gray-700 leading-snug">{t.title}</p>
                                        {t.description && <p className="text-[10px] text-gray-400 leading-snug">{t.description}</p>}
                                        {t.checklist && t.checklist.length > 0 && (
                                          <p className="text-[9px] text-blue-500">{t.checklist.length} checklist item{t.checklist.length !== 1 ? "s" : ""}</p>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        disabled={!parsed || jsonImporting}
                        onClick={() => void importStepsFromJson()}
                        className="bg-[#0A2540] text-white text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-[#0A2540]/90 disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {jsonImporting
                          ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Importing…</>
                          : `Import ${parsed ? parsed.length : ""} Step${parsed?.length !== 1 ? "s" : ""}`}
                      </button>
                      <button type="button" onClick={() => { setJsonImportOpen(false); setJsonImportText(""); }}
                        className="border border-gray-200 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-gray-100 text-gray-600">
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
                  <div className="px-5 py-4 border-b border-gray-100 space-y-3 bg-purple-50/60">
                    <div>
                      <p className="text-xs font-bold text-purple-700 uppercase tracking-wide mb-0.5">Import Engineer Fields Only</p>
                      <p className="text-[10px] text-purple-500 mb-2">Paste an array of tasks by title. Only the 4 engineer fields are updated — title, description, group, and order are left unchanged.</p>
                      <textarea
                        autoFocus
                        rows={10}
                        value={engImportText}
                        onChange={e => setEngImportText(e.target.value)}
                        placeholder={`[\n  {\n    "title": "Review tenant configuration",\n    "instructions": ["Log into M365 admin center", "Navigate to Settings > Org settings"],\n    "checklist": [{ "id": "c1", "label": "License check complete" }, { "id": "c2", "label": "Admin roles reviewed" }],\n    "artifactsProduced": ["Tenant audit report"],\n    "clientDeliverables": ["Gap analysis summary"]\n  }\n]`}
                        className="w-full border border-purple-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-400 resize-y bg-white"
                      />
                    </div>
                    {engImportText.trim() && error && (
                      <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5 font-mono">{error}</p>
                    )}
                    {parsed && parsed.length > 0 && (
                      <div className="bg-white border border-purple-100 rounded-lg p-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-purple-500">
                          {matchCount} task{matchCount !== 1 ? "s" : ""} will be updated
                          {skipCount > 0 && <span className="text-amber-500 ml-1">· {skipCount} not found in this template</span>}
                        </p>
                        {parsed.map((item, i) => {
                          const matched = (byTitle.get(item.title.trim().toLowerCase()) ?? []).length > 0;
                          return (
                            <div key={i} className={`flex items-start gap-2 rounded px-2 py-1.5 ${matched ? "bg-purple-50" : "bg-amber-50"}`}>
                              <span className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold ${matched ? "bg-purple-500 text-white" : "bg-amber-400 text-white"}`}>
                                {matched ? "✓" : "?"}
                              </span>
                              <div className="min-w-0">
                                <p className={`text-[11px] font-semibold leading-snug ${matched ? "text-[#0A2540]" : "text-amber-700"}`}>{item.title}</p>
                                <div className="flex flex-wrap gap-2 mt-0.5">
                                  {item.instructions?.length ? <span className="text-[9px] text-purple-500">{item.instructions.length} instruction{item.instructions.length !== 1 ? "s" : ""}</span> : null}
                                  {item.checklist?.length ? <span className="text-[9px] text-blue-500">{item.checklist.length} checklist item{item.checklist.length !== 1 ? "s" : ""}</span> : null}
                                  {item.artifactsProduced?.length ? <span className="text-[9px] text-teal-500">{item.artifactsProduced.length} artifact{item.artifactsProduced.length !== 1 ? "s" : ""}</span> : null}
                                  {item.clientDeliverables?.length ? <span className="text-[9px] text-green-600">{item.clientDeliverables.length} deliverable{item.clientDeliverables.length !== 1 ? "s" : ""}</span> : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        disabled={!parsed || matchCount === 0 || engImporting}
                        onClick={() => void importEngineerFields()}
                        className="bg-purple-600 text-white text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {engImporting
                          ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Importing…</>
                          : `Update ${matchCount} Task${matchCount !== 1 ? "s" : ""}`}
                      </button>
                      <button type="button" onClick={() => { setEngImportOpen(false); setEngImportText(""); }}
                        className="border border-gray-200 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-gray-100 text-gray-600">
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div>
                {steps.length === 0 && !newStep && !jsonImportOpen && !engImportOpen && (
                  <div className="px-5 py-8 text-center text-sm text-gray-400">
                    No steps yet. Add the first step to define this workflow.
                  </div>
                )}

                {steps.map((step, idx) => {
                  const isExpanded = expandedStepIds.has(step.id);
                  const tasks = step.tasks ?? [];

                  // Group tasks: known groups in order, then anything else
                  const tasksByGroup: Record<string, StepTask[]> = {};
                  for (const t of tasks) {
                    const key = t.groupName ?? "Other";
                    if (!tasksByGroup[key]) tasksByGroup[key] = [];
                    tasksByGroup[key].push(t);
                  }
                  const renderedGroups = [...GROUP_OPTIONS, "Other"].filter(g => tasksByGroup[g]?.length) as string[];

                  return (
                    <div key={step.id} className="border-b border-gray-100 last:border-b-0">
                      {editingStep?.id === step.id ? (
                        <div className="px-5 py-4 space-y-3">
                          <input type="text" value={editingStepForm.title} placeholder="Step title" autoFocus
                            onChange={e => setEditingStepForm(p => ({ ...p, title: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Escape") setEditingStep(null); }}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                          <textarea value={editingStepForm.description} placeholder="Step description (optional)"
                            rows={2}
                            onChange={e => setEditingStepForm(p => ({ ...p, description: e.target.value }))}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
                          <div className="flex gap-2">
                            <button onClick={saveStep} className="text-xs bg-[#0078D4] text-white px-3 py-1.5 rounded-lg font-medium hover:bg-[#006CBE]">Save</button>
                            <button onClick={() => setEditingStep(null)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Step header */}
                          <div className="flex items-center gap-2 px-5 py-3.5">
                            <button onClick={() => toggleStep(step.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#0078D4]/10 text-[#0078D4] text-xs font-bold flex items-center justify-center">
                                {idx + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-[#0A2540] block truncate">{step.title}</span>
                                {step.description && (
                                  <span className="text-xs text-gray-400 block truncate">{step.description}</span>
                                )}
                              </div>
                              {tasks.length > 0 && (
                                <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 flex-shrink-0">
                                  {tasks.length} task{tasks.length !== 1 ? "s" : ""}
                                </span>
                              )}
                              <svg className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button onClick={() => void moveStep(step, "up")} disabled={idx === 0}
                                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                              </button>
                              <button onClick={() => void moveStep(step, "down")} disabled={idx === steps.length - 1}
                                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              <button
                                onClick={() => { setEditingStep(step); setEditingStepForm({ title: step.title, description: step.description ?? "" }); }}
                                className="p-1 text-gray-400 hover:text-[#0078D4]">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button onClick={() => void deleteStep(step.id)} className="p-1 text-gray-400 hover:text-red-500">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          {/* Expanded: task groups */}
                          {isExpanded && (
                            <div className="bg-gray-50 border-t border-gray-100 px-5 py-4 space-y-5">
                              {tasks.length === 0 && !newTask && (
                                <p className="text-xs text-gray-400 italic">No tasks yet for this step.</p>
                              )}

                              {renderedGroups.map(group => (
                                <div key={group}>
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{group}</span>
                                    <div className="flex-1 h-px bg-gray-200" />
                                  </div>
                                  <div className="space-y-1.5">
                                    {(tasksByGroup[group] ?? []).map(task => (
                                      <TaskCard
                                        key={task.id}
                                        task={task}
                                        templateId={selected.id}
                                        onEdit={t => {
                                          setEditingTask(t);
                                          setEditingTaskForm({
                                            title: t.title,
                                            groupName: t.groupName ?? "",
                                            description: t.description ?? "",
                                            instructions: t.instructions ?? [],
                                            checklist: t.checklist ?? [],
                                            artifactsProduced: t.artifactsProduced ?? [],
                                            clientDeliverables: t.clientDeliverables ?? [],
                                            instructionSetId: t.instructionSetId ?? null,
                                            checklistId: t.checklistId ?? null,
                                            artifactsId: t.artifactsId ?? null,
                                            deliverablesId: t.deliverablesId ?? null,
                                          });
                                        }}
                                        onDelete={t => void deleteTask(t)}
                                        editingTask={editingTask}
                                        editingTaskForm={editingTaskForm}
                                        setEditingTaskForm={setEditingTaskForm}
                                        onSaveTask={() => void saveTask()}
                                        onCancelEdit={() => setEditingTask(null)}
                                        instructionSets={instructionSets}
                                        checklists={checklists}
                                        artifactSets={artifactSets}
                                        deliverableSets={deliverableSets}
                                      />
                                    ))}
                                  </div>
                                </div>
                              ))}

                              {/* Add task form */}
                              {newTask?.stepId === step.id ? (
                                <div className="bg-white rounded-lg border border-[#0078D4] p-3 space-y-2">
                                  <input
                                    type="text"
                                    value={newTask.title}
                                    placeholder="Task title"
                                    autoFocus
                                    onChange={e => setNewTask(p => p ? { ...p, title: e.target.value } : p)}
                                    onKeyDown={e => { if (e.key === "Enter") void addTask(); if (e.key === "Escape") setNewTask(null); }}
                                    className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                                  />
                                  <select
                                    value={newTask.groupName}
                                    onChange={e => setNewTask(p => p ? { ...p, groupName: e.target.value } : p)}
                                    className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                                  >
                                    <option value="">No group</option>
                                    {GROUP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                  <p className="text-[10px] text-gray-400 italic">Save, then click Edit to add instructions, checklist, and deliverables.</p>
                                  <div className="flex gap-2">
                                    <button onClick={() => void addTask()} className="text-xs bg-[#0078D4] text-white px-3 py-1.5 rounded font-medium hover:bg-[#006CBE]">Add Task</button>
                                    <button onClick={() => setNewTask(null)} className="text-xs text-gray-500 px-3 py-1.5">Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setNewTask({ stepId: step.id, title: "", groupName: GROUP_OPTIONS[0], description: "" })}
                                  className="text-xs text-[#0078D4] hover:underline font-medium flex items-center gap-1">
                                  + Add task to this step
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

                {/* New step form */}
                {newStep !== null && (
                  <div className="px-5 py-4 space-y-3 bg-blue-50 border-t border-gray-100">
                    <input type="text" value={newStep.title} placeholder="Step title" autoFocus
                      onChange={e => setNewStep(p => p ? { ...p, title: e.target.value } : p)}
                      onKeyDown={e => { if (e.key === "Escape") setNewStep(null); }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                    <textarea value={newStep.description} placeholder="Step description (optional)"
                      rows={2}
                      onChange={e => setNewStep(p => p ? { ...p, description: e.target.value } : p)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
                    <div className="flex gap-2">
                      <button onClick={() => void addStep()} className="text-xs bg-[#0078D4] text-white px-3 py-1.5 rounded-lg font-medium hover:bg-[#006CBE]">Add Step</button>
                      <button onClick={() => setNewStep(null)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
