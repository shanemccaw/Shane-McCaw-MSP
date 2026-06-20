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

interface WorkflowStep {
  id: number;
  title: string;
  status: string;
  order: number;
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

interface ProjectWithSteps extends Project {
  steps: WorkflowStep[];
}

interface TrackConfig {
  num: string;
  type: string;
  label: string;
  description: string;
  icon: string;
  color: string;
}

const TRACKS: TrackConfig[] = [
  {
    num: "01",
    type: "micro-offer",
    label: "Micro-Offers",
    description: "Fixed-price, rapid-delivery engagements",
    icon: "bolt",
    color: "#00B4D8",
  },
  {
    num: "02",
    type: "project",
    label: "Project-Based Engagements",
    description: "Scoped deliverables with defined milestones",
    icon: "folder_open",
    color: "#0078D4",
  },
  {
    num: "03",
    type: "retainer",
    label: "Monthly Fractional Retainers",
    description: "Ongoing advisory with dedicated monthly hours",
    icon: "workspace_premium",
    color: "#7C3AED",
  },
];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: "In Progress", cls: "bg-blue-100 text-blue-700" },
  on_hold: { label: "Paused", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Complete", cls: "bg-emerald-100 text-emerald-700" },
};

function MatIcon({ name, className = "", style }: { name: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className={`material-symbols-outlined select-none leading-none ${className}`}
      style={{ fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24", ...style }}
    >
      {name}
    </span>
  );
}

function SegmentedBar({ steps }: { steps: WorkflowStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-20 rounded-full bg-[#E8EDF3]" />
        <span className="text-xs text-muted-foreground">No steps</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((step) => {
        let bg = "bg-[#E8EDF3]";
        let extra = "";
        if (step.status === "completed") bg = "bg-[#0078D4]";
        else if (step.status === "in_progress") {
          bg = "bg-[#0078D4]/60";
          extra = "animate-pulse";
        }
        return (
          <div
            key={step.id}
            title={step.title}
            className={`h-1.5 rounded-full flex-1 min-w-[6px] max-w-[28px] ${bg} ${extra} transition-all`}
          />
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGE[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function ServiceCard({
  project,
  steps,
  onDetails,
  onEdit,
  onDelete,
  trackColor,
}: {
  project: Project;
  steps: WorkflowStep[];
  onDetails: () => void;
  onEdit: () => void;
  onDelete: () => void;
  trackColor: string;
}) {
  const currentStep = steps.find(s => s.status === "in_progress") ?? steps.find(s => s.status === "pending");
  const completedCount = steps.filter(s => s.status === "completed").length;
  const eta = project.endDate ? new Date(project.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  let actionBtn = { label: "Details", icon: "open_in_new" };
  if (project.status === "completed") actionBtn = { label: "Archive", icon: "archive" };
  else if (project.status === "on_hold") actionBtn = { label: "Resume", icon: "play_arrow" };

  return (
    <div className="bg-white border border-border rounded-xl overflow-hidden hover:shadow-sm transition-shadow">
      <div className="px-5 pt-4 pb-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${trackColor}18` }}>
              <MatIcon name="dataset" className="text-sm" style={{ color: trackColor } as React.CSSProperties} />
            </div>
            <p className="font-semibold text-[#0A2540] text-sm leading-tight truncate">{project.title}</p>
          </div>
          <StatusBadge status={project.status} />
        </div>

        <SegmentedBar steps={steps} />

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div>
            <span className="text-muted-foreground">Milestone</span>
            <p className="font-medium text-[#0A2540] truncate">{currentStep?.title ?? project.phase ?? "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Next Action</span>
            <p className="font-medium text-[#0A2540] truncate">
              {steps.length > 0 ? `Step ${completedCount + 1} of ${steps.length}` : project.phase ?? "—"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">ETA</span>
            <p className="font-medium text-[#0A2540]">{eta}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Progress</span>
            <p className="font-medium text-[#0A2540]">{project.progress}%</p>
          </div>
        </div>
      </div>

      <div className="border-t border-border px-5 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onEdit}
            className="text-xs font-medium text-muted-foreground hover:text-[#0A2540] transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-xs font-medium text-red-400 hover:text-red-600 transition-colors"
          >
            Delete
          </button>
        </div>
        <button
          onClick={onDetails}
          className="flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors"
        >
          {actionBtn.label}
          <MatIcon name="chevron_right" className="text-base leading-none" />
        </button>
      </div>
    </div>
  );
}

function RetainerCard({
  project,
  steps,
  onDetails,
  onEdit,
  onDelete,
}: {
  project: Project;
  steps: WorkflowStep[];
  onDetails: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const completedSteps = steps.filter(s => s.status === "completed").length;
  const hoursBase = Math.round(project.progress * 0.4);
  const governanceScore = project.status === "completed" ? 98 : project.status === "active" ? Math.max(72, Math.round(project.progress * 0.28 + 70)) : 65;
  const activePillars = Math.max(1, Math.ceil(completedSteps / 2));
  const priorityLabel = project.status === "active" ? "Strategic" : project.status === "completed" ? "Archived" : "On Hold";
  const eta = project.endDate ? new Date(project.endDate).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—";

  return (
    <div className="rounded-xl overflow-hidden border border-[#1e3a5f] bg-gradient-to-br from-[#0A2540] via-[#0d2d50] to-[#0a1f38]">
      <div className="px-5 pt-5 pb-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#7C3AED]/20 flex items-center justify-center flex-shrink-0">
              <MatIcon name="workspace_premium" className="text-[#a78bfa]" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-white text-sm leading-tight truncate">{project.title}</p>
              <p className="text-xs text-[#94a3b8] mt-0.5">{project.phase ?? "Monthly Retainer"}</p>
            </div>
          </div>
          <StatusBadge status={project.status} />
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-[#94a3b8]">
            <span>Engagement Progress</span>
            <span className="text-white font-medium">{project.progress}%</span>
          </div>
          <SegmentedBar steps={steps} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Hours Utilized", value: `${hoursBase}h`, icon: "schedule", color: "#60a5fa" },
            { label: "Governance Score", value: `${governanceScore}`, icon: "verified", color: "#34d399" },
            { label: "Active Pillars", value: String(activePillars), icon: "grid_view", color: "#a78bfa" },
            { label: "Priority Status", value: priorityLabel, icon: "flag", color: "#fb923c" },
          ].map(tile => (
            <div key={tile.label} className="bg-white/5 rounded-lg p-3 border border-white/10">
              <div className="flex items-center gap-1.5 mb-1">
                <MatIcon name={tile.icon} className="text-sm" style={{ color: tile.color } as React.CSSProperties} />
                <span className="text-[10px] text-[#94a3b8] uppercase tracking-wide">{tile.label}</span>
              </div>
              <p className="text-sm font-bold text-white">{tile.value}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-[#94a3b8]">
          <MatIcon name="event" className="text-sm text-[#60a5fa]" />
          <span>Next review:</span>
          <span className="text-white font-medium">{eta}</span>
        </div>
      </div>

      <div className="border-t border-white/10 px-5 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onEdit} className="text-xs font-medium text-[#94a3b8] hover:text-white transition-colors">Edit</button>
          <button onClick={onDelete} className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors">Delete</button>
        </div>
        <button
          onClick={onDetails}
          className="flex items-center gap-1 text-xs font-semibold text-[#60a5fa] hover:text-[#93c5fd] transition-colors"
        >
          Details
          <MatIcon name="chevron_right" className="text-base leading-none" />
        </button>
      </div>
    </div>
  );
}

function TrackSection({
  track,
  projects,
  steps,
  onDetails,
  onEdit,
  onDelete,
}: {
  track: TrackConfig;
  projects: ProjectWithSteps[];
  steps: Record<number, WorkflowStep[]>;
  onDetails: (id: number) => void;
  onEdit: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  const isRetainer = track.type === "retainer";
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${track.color}18` }}
        >
          <MatIcon name={track.icon} className="text-base" style={{ color: track.color } as React.CSSProperties} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase">Track {track.num}</span>
            <span className="text-xs text-border">·</span>
            <span className="text-sm font-bold text-[#0A2540]">{track.label}</span>
          </div>
          <p className="text-xs text-muted-foreground">{track.description}</p>
        </div>
        <div className="ml-auto">
          <span className="text-xs font-semibold text-muted-foreground bg-[#F7F9FC] border border-border rounded-full px-2.5 py-0.5">
            {projects.length} {projects.length === 1 ? "engagement" : "engagements"}
          </span>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl py-8 text-center text-sm text-muted-foreground">
          No {track.label.toLowerCase()} yet
        </div>
      ) : (
        <div className={`grid gap-4 ${isRetainer ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
          {projects.map(p => {
            const projectSteps = steps[p.id] ?? [];
            return isRetainer ? (
              <RetainerCard
                key={p.id}
                project={p}
                steps={projectSteps}
                onDetails={() => onDetails(p.id)}
                onEdit={() => onEdit(p)}
                onDelete={() => onDelete(p)}
              />
            ) : (
              <ServiceCard
                key={p.id}
                project={p}
                steps={projectSteps}
                trackColor={track.color}
                onDetails={() => onDetails(p.id)}
                onEdit={() => onEdit(p)}
                onDelete={() => onDelete(p)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function PortfolioHeader() {
  return (
    <div className="mb-8">
      <span className="inline-block text-[10px] font-bold text-[#0078D4] bg-[#0078D4]/10 rounded-full px-3 py-1 uppercase tracking-widest mb-3">
        Global Portfolio
      </span>
      <h2 className="text-2xl font-extrabold text-[#0A2540] tracking-tight">Active Services Portfolio</h2>
      <div className="mt-3 border-b border-border" />
    </div>
  );
}

function PortfolioFooterBar({ projects }: { projects: ProjectWithSteps[] }) {
  const active = projects.filter(p => p.status === "active").length;
  const avgProgress = projects.length > 0 ? Math.round(projects.reduce((s, p) => s + p.progress, 0) / projects.length) : 0;
  const sla = projects.length > 0 ? Math.round((projects.filter(p => p.status !== "on_hold").length / projects.length) * 100) : 100;
  const nextReview = projects
    .filter(p => p.endDate && p.status === "active")
    .map(p => new Date(p.endDate!))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const nextReviewLabel = nextReview ? nextReview.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  const metrics = [
    { icon: "work", label: "Active Engagements", value: String(active) },
    { icon: "trending_up", label: "Cumulative Progress", value: `${avgProgress}%` },
    { icon: "verified_user", label: "SLA Compliance", value: `${sla}%` },
    { icon: "event_upcoming", label: "Next Review", value: nextReviewLabel },
  ];

  return (
    <div className="mt-8 border border-border rounded-xl bg-[#F7F9FC] overflow-hidden">
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
        {metrics.map(m => (
          <div key={m.label} className="flex items-center gap-3 px-5 py-4">
            <MatIcon name={m.icon} className="text-2xl text-[#0078D4]" />
            <div>
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-lg font-extrabold text-[#0A2540]">{m.value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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

  const [projects, setProjects] = useState<ProjectWithSteps[]>([]);
  const [steps, setSteps] = useState<Record<number, WorkflowStep[]>>({});
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
    if (clientRes.ok) setClients(await clientRes.json() as Client[]);
    if (!projRes.ok) { setLoading(false); return; }

    const rawProjects = await projRes.json() as Project[];

    const stepsResults = await Promise.all(
      rawProjects.map(p => fetchWithAuth(`/api/admin/workflow-steps?projectId=${p.id}`).then(r => r.ok ? r.json() as Promise<WorkflowStep[]> : Promise.resolve([])))
    );

    const stepsMap: Record<number, WorkflowStep[]> = {};
    rawProjects.forEach((p, i) => { stepsMap[p.id] = stepsResults[i]; });

    setProjects(rawProjects.map(p => ({ ...p, steps: stepsMap[p.id] })));
    setSteps(stepsMap);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

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

  const byType = (type: string) => projects.filter(p => p.projectType === type);

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#0A2540]">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage client projects grouped by engagement track. Click <strong>Details</strong> to open the kanban board.
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); setError(""); }}
          className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
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
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name ?? c.email}{c.company ? ` (${c.company})` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Type</label>
              <select value={form.projectType} onChange={e => setForm(f => ({ ...f, projectType: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                <option value="project">Project-Based</option>
                <option value="retainer">Monthly Retainer</option>
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
            {error && (
              <div className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
            )}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : editingId ? "Save Changes" : "Create Project"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setError(""); }}
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <PortfolioHeader />

          <div className="space-y-10">
            {TRACKS.map(track => (
              <TrackSection
                key={track.type}
                track={track}
                projects={byType(track.type)}
                steps={steps}
                onDetails={id => navigate(`/crm/projects/${id}`)}
                onEdit={p => handleEdit(p)}
                onDelete={p => setDeleteTarget(p)}
              />
            ))}
          </div>

          <PortfolioFooterBar projects={projects} />
        </>
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
