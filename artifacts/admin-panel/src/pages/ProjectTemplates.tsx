import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface ProjectTemplateTask {
  id: number;
  projectTemplateId: number;
  title: string;
  description: string | null;
  order: number;
}

interface ProjectTemplate {
  id: number;
  name: string;
  workflowTemplateId: number | null;
  serviceId: number | null;
  tasks?: ProjectTemplateTask[];
}

interface Service { id: number; name: string; }
interface WorkflowTemplate { id: number; name: string; }

export default function ProjectTemplatesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [selected, setSelected] = useState<ProjectTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detailForm, setDetailForm] = useState<{ name: string; workflowTemplateId: number | null; serviceId: number | null }>({ name: "", workflowTemplateId: null, serviceId: null });
  const [newTask, setNewTask] = useState<{ title: string; description: string } | null>(null);
  const [editingTask, setEditingTask] = useState<ProjectTemplateTask | null>(null);
  const [editingTaskForm, setEditingTaskForm] = useState({ title: "", description: "" });

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/project-templates");
      if (!res.ok) return;
      setTemplates(await res.json() as ProjectTemplate[]);
    } finally { setLoading(false); }
  }, [fetchWithAuth]);

  const fetchMeta = useCallback(async () => {
    const [sRes, wRes] = await Promise.all([
      fetchWithAuth("/api/admin/services"),
      fetchWithAuth("/api/admin/workflow-templates"),
    ]);
    if (sRes.ok) setServices(await sRes.json() as Service[]);
    if (wRes.ok) setWorkflows(await wRes.json() as WorkflowTemplate[]);
  }, [fetchWithAuth]);

  useEffect(() => {
    void fetchTemplates();
    void fetchMeta();
  }, [fetchTemplates, fetchMeta]);

  async function selectTemplate(t: ProjectTemplate) {
    const res = await fetchWithAuth(`/api/admin/project-templates/${t.id}`);
    if (!res.ok) return;
    const data = await res.json() as ProjectTemplate;
    setSelected(data);
    setDetailForm({ name: data.name, workflowTemplateId: data.workflowTemplateId, serviceId: data.serviceId });
  }

  async function createTemplate() {
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/admin/project-templates", {
        method: "POST",
        body: JSON.stringify({ name: "New Project Template" }),
      });
      if (!res.ok) { toast({ title: "Failed to create", variant: "destructive" }); return; }
      const t = await res.json() as ProjectTemplate;
      await fetchTemplates();
      await selectTemplate(t);
    } finally { setSaving(false); }
  }

  async function saveTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/project-templates/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify(detailForm),
      });
      if (!res.ok) { toast({ title: "Failed to save", variant: "destructive" }); return; }
      toast({ title: "Template saved" });
      await fetchTemplates();
    } finally { setSaving(false); }
  }

  async function deleteTemplate() {
    if (!selected || !confirm(`Delete "${selected.name}"?`)) return;
    await fetchWithAuth(`/api/admin/project-templates/${selected.id}`, { method: "DELETE" });
    setSelected(null);
    await fetchTemplates();
    toast({ title: "Template deleted" });
  }

  async function addTask() {
    if (!selected || !newTask?.title.trim()) return;
    const maxOrder = (selected.tasks ?? []).reduce((m, t) => Math.max(m, t.order), -1);
    const res = await fetchWithAuth(`/api/admin/project-templates/${selected.id}/tasks`, {
      method: "POST",
      body: JSON.stringify({ title: newTask.title, description: newTask.description || null, order: maxOrder + 1 }),
    });
    if (!res.ok) { toast({ title: "Failed to add task", variant: "destructive" }); return; }
    setNewTask(null);
    await selectTemplate(selected);
  }

  async function saveTask() {
    if (!selected || !editingTask) return;
    const res = await fetchWithAuth(`/api/admin/project-templates/${selected.id}/tasks/${editingTask.id}`, {
      method: "PUT",
      body: JSON.stringify({ title: editingTaskForm.title, description: editingTaskForm.description || null, order: editingTask.order }),
    });
    if (!res.ok) { toast({ title: "Failed to save task", variant: "destructive" }); return; }
    setEditingTask(null);
    await selectTemplate(selected);
  }

  async function deleteTask(taskId: number) {
    if (!selected) return;
    await fetchWithAuth(`/api/admin/project-templates/${selected.id}/tasks/${taskId}`, { method: "DELETE" });
    await selectTemplate(selected);
  }

  const tasks = (selected?.tasks ?? []).slice().sort((a, b) => a.order - b.order);

  return (
    <div className="flex h-full">
      {/* Template list */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-[#0A2540] text-sm">Project Templates</h2>
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <p className="text-sm">Select or create a project template</p>
            </div>
          </div>
        ) : (
          <div className="p-6 max-w-2xl">
            <form onSubmit={saveTemplate} className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[#0A2540]">Template Details</h3>
                <div className="flex gap-2">
                  <button type="button" onClick={deleteTemplate}
                    className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">Delete</button>
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
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Workflow Template</label>
                  <select value={detailForm.workflowTemplateId ?? ""}
                    onChange={e => setDetailForm(p => ({ ...p, workflowTemplateId: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]">
                    <option value="">None</option>
                    {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Service Offering</label>
                  <select value={detailForm.serviceId ?? ""}
                    onChange={e => setDetailForm(p => ({ ...p, serviceId: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]">
                    <option value="">None</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
            </form>

            {/* Tasks */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-[#0A2540]">Default Tasks <span className="text-gray-400 font-normal text-sm">({tasks.length})</span></h3>
                <button onClick={() => setNewTask({ title: "", description: "" })}
                  className="text-xs text-[#0078D4] hover:underline font-medium">+ Add task</button>
              </div>
              <div className="divide-y divide-gray-100">
                {tasks.length === 0 && !newTask && (
                  <div className="px-5 py-8 text-center text-sm text-gray-400">No tasks yet. Add default tasks for this template.</div>
                )}
                {tasks.map((task, idx) => (
                  <div key={task.id} className="px-5 py-4">
                    {editingTask?.id === task.id ? (
                      <div className="space-y-3">
                        <input type="text" value={editingTaskForm.title} placeholder="Task title"
                          onChange={e => setEditingTaskForm(p => ({ ...p, title: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                        <textarea value={editingTaskForm.description} rows={2} placeholder="Description (optional)"
                          onChange={e => setEditingTaskForm(p => ({ ...p, description: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
                        <div className="flex gap-2">
                          <button onClick={saveTask} className="text-xs bg-[#0078D4] text-white px-3 py-1.5 rounded-lg font-medium hover:bg-[#006CBE]">Save</button>
                          <button onClick={() => setEditingTask(null)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-bold flex items-center justify-center mt-0.5">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#0A2540]">{task.title}</p>
                          {task.description && <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => { setEditingTask(task); setEditingTaskForm({ title: task.title, description: task.description ?? "" }); }}
                            className="p-1 text-gray-400 hover:text-[#0078D4]">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button onClick={() => void deleteTask(task.id)} className="p-1 text-gray-400 hover:text-red-500">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {newTask !== null && (
                  <div className="px-5 py-4 space-y-3 bg-green-50">
                    <input type="text" value={newTask.title} placeholder="Task title" autoFocus
                      onChange={e => setNewTask(p => p ? { ...p, title: e.target.value } : p)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                    <textarea value={newTask.description} rows={2} placeholder="Description (optional)"
                      onChange={e => setNewTask(p => p ? { ...p, description: e.target.value } : p)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
                    <div className="flex gap-2">
                      <button onClick={() => void addTask()} className="text-xs bg-[#0078D4] text-white px-3 py-1.5 rounded-lg font-medium hover:bg-[#006CBE]">Add Task</button>
                      <button onClick={() => setNewTask(null)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
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
