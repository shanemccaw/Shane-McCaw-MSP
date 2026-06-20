import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

const GROUP_OPTIONS = ["Engineer Tasks", "Artifacts Produced", "Client Deliverables"] as const;
type GroupOption = typeof GROUP_OPTIONS[number];

interface StepTask {
  id: number;
  title: string;
  description: string | null;
  groupName: string | null;
  order: number;
  workflowTemplateStepId: number | null;
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
}: {
  task: StepTask;
  templateId: number;
  onEdit: (t: StepTask) => void;
  onDelete: (t: StepTask) => void;
  editingTask: StepTask | null;
  editingTaskForm: { title: string; groupName: string; description: string };
  setEditingTaskForm: React.Dispatch<React.SetStateAction<{ title: string; groupName: string; description: string }>>;
  onSaveTask: () => void;
  onCancelEdit: () => void;
}) {
  if (editingTask?.id === task.id) {
    return (
      <div className="bg-white rounded-lg border border-[#0078D4] p-3 space-y-2">
        <input
          type="text"
          value={editingTaskForm.title}
          placeholder="Task title"
          autoFocus
          onChange={e => setEditingTaskForm(p => ({ ...p, title: e.target.value }))}
          onKeyDown={e => { if (e.key === "Enter") onSaveTask(); if (e.key === "Escape") onCancelEdit(); }}
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
        <div className="flex gap-2">
          <button onClick={onSaveTask} className="text-xs bg-[#0078D4] text-white px-3 py-1.5 rounded font-medium hover:bg-[#006CBE]">Save</button>
          <button onClick={onCancelEdit} className="text-xs text-gray-500 px-3 py-1.5">Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2 group/task">
      <svg className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
      <span className="text-sm text-[#0A2540] flex-1 leading-snug">{task.title}</span>
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

export default function WorkflowsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selected, setSelected] = useState<WorkflowTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detailForm, setDetailForm] = useState<{ name: string; description: string; serviceId: number | null }>({ name: "", description: "", serviceId: null });

  // Step state
  const [newStep, setNewStep] = useState<{ title: string; description: string } | null>(null);
  const [editingStep, setEditingStep] = useState<WorkflowStep | null>(null);
  const [editingStepForm, setEditingStepForm] = useState({ title: "", description: "" });
  const [expandedStepIds, setExpandedStepIds] = useState<Set<number>>(new Set());

  // JSON import state
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [jsonImportText, setJsonImportText] = useState("");
  const [jsonImporting, setJsonImporting] = useState(false);

  // Task state
  const [newTask, setNewTask] = useState<{ stepId: number; title: string; groupName: string; description: string } | null>(null);
  const [editingTask, setEditingTask] = useState<StepTask | null>(null);
  const [editingTaskForm, setEditingTaskForm] = useState({ title: "", groupName: "", description: "" });

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

  useEffect(() => {
    void fetchTemplates();
    void fetchServices();
  }, [fetchTemplates, fetchServices]);

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

  function parseTemplateSteps(text: string): { parsed: Array<{ title: string; description?: string }> | null; error: string | null } {
    if (!text.trim()) return { parsed: null, error: null };
    try {
      const raw: unknown = JSON.parse(text);
      if (!Array.isArray(raw)) return { parsed: null, error: "JSON must be an array [ … ]" };
      if (raw.length === 0) return { parsed: null, error: "Array is empty" };
      const items = raw as Array<Record<string, unknown>>;
      const missingTitle = items.findIndex(s => !s.title || typeof s.title !== "string" || !(s.title as string).trim());
      if (missingTitle !== -1) return { parsed: null, error: `Item at index ${missingTitle} is missing a "title"` };
      return { parsed: items as Array<{ title: string; description?: string }>, error: null };
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
      for (let i = 0; i < parsed.length; i++) {
        const s = parsed[i];
        const res = await fetchWithAuth(`/api/admin/workflow-templates/${selected.id}/steps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: s.title.trim(), description: s.description?.trim() || null, order: maxOrder + 1 + i }),
        });
        if (!res.ok) {
          toast({ title: `Failed at step ${i + 1}`, variant: "destructive" });
          await refreshSelected();
          return;
        }
      }
      setJsonImportOpen(false);
      setJsonImportText("");
      await refreshSelected();
      toast({ title: "Steps imported", description: `${parsed.length} step${parsed.length !== 1 ? "s" : ""} added successfully.` });
    } finally {
      setJsonImporting(false);
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
        body: JSON.stringify({ title: editingTaskForm.title, description: editingTaskForm.description || null, groupName: editingTaskForm.groupName || null, order: editingTask.order }),
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
                    onClick={() => { setJsonImportOpen(v => !v); setJsonImportText(""); setNewStep(null); }}
                    className="flex items-center gap-1 text-xs text-[#00B4D8] hover:underline font-medium">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2M9 12l3 3 3-3M12 3v12" />
                    </svg>
                    Import from JSON
                  </button>
                  <button onClick={() => { setNewStep({ title: "", description: "" }); setJsonImportOpen(false); }}
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
                        rows={6}
                        value={jsonImportText}
                        onChange={e => setJsonImportText(e.target.value)}
                        placeholder={`[\n  {\n    "title": "Discovery & Assessment",\n    "description": "Review current M365 environment"\n  },\n  { "title": "Architecture Design" }\n]`}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#00B4D8] resize-y bg-white"
                      />
                    </div>
                    {jsonImportText.trim() && error && (
                      <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5 font-mono">{error}</p>
                    )}
                    {parsed && parsed.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">{parsed.length} step{parsed.length !== 1 ? "s" : ""} to add</p>
                        {parsed.map((s, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <span className="w-5 h-5 rounded-full bg-[#0078D4]/10 text-[#0078D4] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                            <div className="min-w-0">
                              <p className="font-semibold text-[#0A2540] leading-snug">{s.title}</p>
                              {s.description && <p className="text-gray-400 mt-0.5 leading-snug">{s.description}</p>}
                            </div>
                          </div>
                        ))}
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

              <div>
                {steps.length === 0 && !newStep && !jsonImportOpen && (
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
                            onKeyDown={e => { if (e.key === "Enter") void saveStep(); if (e.key === "Escape") setEditingStep(null); }}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
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
                              <span className="text-sm font-medium text-[#0A2540] flex-1 truncate">{step.title}</span>
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
                                        onEdit={t => { setEditingTask(t); setEditingTaskForm({ title: t.title, groupName: t.groupName ?? "", description: t.description ?? "" }); }}
                                        onDelete={t => void deleteTask(t)}
                                        editingTask={editingTask}
                                        editingTaskForm={editingTaskForm}
                                        setEditingTaskForm={setEditingTaskForm}
                                        onSaveTask={() => void saveTask()}
                                        onCancelEdit={() => setEditingTask(null)}
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
                      onKeyDown={e => { if (e.key === "Enter") void addStep(); if (e.key === "Escape") setNewStep(null); }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
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
