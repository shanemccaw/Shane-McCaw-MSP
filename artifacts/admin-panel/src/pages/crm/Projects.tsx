import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Client {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
}

interface Project {
  id: number;
  title: string;
  description: string | null;
  status: string;
  phase: string | null;
  progress: number;
  clientUserId: number | null;
  startDate: string | null;
  endDate: string | null;
  projectType: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  on_hold: "bg-yellow-100 text-yellow-700",
  completed: "bg-blue-100 text-blue-700",
};

interface ProjectFormState {
  title: string;
  description: string;
  status: string;
  phase: string;
  progress: number;
  clientUserId: string;
  startDate: string;
  endDate: string;
  projectType: string;
}

const EMPTY_FORM: ProjectFormState = {
  title: "", description: "", status: "active", phase: "", progress: 0, clientUserId: "", startDate: "", endDate: "", projectType: "project",
};

export default function ProjectsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProjectFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    const [projRes, clientRes] = await Promise.all([
      fetchWithAuth("/api/admin/projects"),
      fetchWithAuth("/api/admin/clients"),
    ]);
    if (projRes.ok) setProjects(await projRes.json() as Project[]);
    if (clientRes.ok) setClients(await clientRes.json() as Client[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const clientName = (id: number | null) => {
    const c = clients.find(c => c.id === id);
    if (!c) return "Unassigned";
    const person = c.name ?? c.email;
    return c.company ? `${c.company} · ${person}` : person;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload = {
        ...form,
        progress: Number(form.progress),
        clientUserId: form.clientUserId ? Number(form.clientUserId) : null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        phase: form.phase || null,
        description: form.description || null,
      };
      let res: Response;
      if (editingId) {
        res = await fetchWithAuth(`/api/admin/projects/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetchWithAuth("/api/admin/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const err = await res.json() as { error: string };
        setError(err.error);
      } else {
        setShowForm(false);
        setEditingId(null);
        setForm(EMPTY_FORM);
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/projects/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Project deleted", description: `"${deleteTarget.title}" and all its data have been removed.` });
        setDeleteTarget(null);
        await load();
      } else {
        const err = await res.json() as { error: string };
        toast({ title: "Delete failed", description: err.error, variant: "destructive" });
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleEdit = (p: Project) => {
    setEditingId(p.id);
    setForm({
      title: p.title,
      description: p.description ?? "",
      status: p.status,
      phase: p.phase ?? "",
      progress: p.progress,
      clientUserId: p.clientUserId ? String(p.clientUserId) : "",
      startDate: p.startDate ? new Date(p.startDate).toISOString().split("T")[0] : "",
      endDate: p.endDate ? new Date(p.endDate).toISOString().split("T")[0] : "",
      projectType: p.projectType ?? "project",
    });
    setShowForm(true);
  };

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#0A2540]">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Create and manage client projects. Click <strong>View</strong> on a project to manage its kanban board and workflow steps.</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); setError(""); }}
          className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          New Project
        </button>
      </div>

      {showForm && (
        <div className="bg-[#F7F9FC] border border-border rounded-xl p-5 mb-6">
          <h3 className="text-sm font-bold text-[#0A2540] mb-4">{editingId ? "Edit Project" : "New Project"}</h3>
          <form onSubmit={e => void handleSubmit(e)} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Title *</label>
              <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Description</label>
              <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Client</label>
              <select value={form.clientUserId} onChange={e => setForm(f => ({ ...f, clientUserId: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                <option value="">— Unassigned —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name ?? c.email}{c.company ? ` (${c.company})` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Type</label>
              <select value={form.projectType} onChange={e => setForm(f => ({ ...f, projectType: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                <option value="project">Project</option>
                <option value="retainer">Retainer</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Phase</label>
              <input value={form.phase} onChange={e => setForm(f => ({ ...f, phase: e.target.value }))}
                placeholder="e.g. Pilot Phase" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Progress ({form.progress}%)</label>
              <input type="range" min={0} max={100} value={form.progress} onChange={e => setForm(f => ({ ...f, progress: Number(e.target.value) }))}
                className="w-full accent-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Start Date</label>
              <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Target End Date</label>
              <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            {error && <div className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : editingId ? "Save Changes" : "Create Project"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setError(""); }}
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : projects.length === 0 ? (
        <div className="bg-white border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">No projects yet.</div>
      ) : (
        <div className="space-y-2">
          {projects.map(p => (
            <div key={p.id} className="bg-white border border-border rounded-xl overflow-hidden">
              <div className="flex items-center gap-4 px-5 py-4">
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => navigate(`/crm/projects/${p.id}`)}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="font-semibold text-[#0A2540] hover:text-[#0078D4] transition-colors">{p.title}</p>
                    {p.phase && <span className="text-xs text-muted-foreground bg-[#F7F9FC] border border-border rounded px-2 py-0.5">{p.phase}</span>}
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {p.status.replace("_", " ")}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">{p.projectType}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-1.5">
                    <span className="text-xs text-muted-foreground">{clientName(p.clientUserId)}</span>
                    {p.description && (
                      <span className="text-xs text-muted-foreground truncate max-w-[280px]">{p.description}</span>
                    )}
                    <div className="flex items-center gap-1.5">
                      <div className="w-20 bg-[#F7F9FC] rounded-full h-1.5 border border-border">
                        <div className="h-1.5 rounded-full bg-[#0078D4]" style={{ width: `${p.progress}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{p.progress}%</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <button
                    onClick={() => navigate(`/crm/projects/${p.id}`)}
                    className="text-xs font-semibold text-[#0078D4] hover:underline flex items-center gap-1"
                  >
                    View
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleEdit(p); }}
                    className="text-xs font-semibold text-muted-foreground hover:text-[#0A2540] hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteTarget(p); }}
                    className="text-xs font-semibold text-red-500 hover:text-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.title}</strong> and all its workflow steps and Kanban tasks. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? "Deleting…" : "Delete Project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
