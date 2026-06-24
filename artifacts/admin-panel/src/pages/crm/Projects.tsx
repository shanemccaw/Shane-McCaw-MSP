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

interface WorkflowTemplate {
  id: number;
  name: string;
  description: string | null;
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
  type: string | string[];
  label: string;
  description: string;
  icon: string;
  color: string;
}

const TRACKS: TrackConfig[] = [
  {
    num: "01",
    type: ["micro-offer", "project"],
    label: "Micro-Offers",
    description: "Fixed-price, rapid-delivery engagements",
    icon: "bolt",
    color: "#00B4D8",
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
  active: { label: "In Progress", cls: "bg-[#0078D4]/100/15 text-blue-400" },
  on_hold: { label: "Paused", cls: "bg-amber-500/100/15 text-amber-400" },
  completed: { label: "Complete", cls: "bg-emerald-500/15 text-emerald-400" },
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
  const cfg = STATUS_BADGE[status] ?? { label: status, cls: "bg-[#30363D]/50 text-[#7D8590]" };
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
  const [, navigate] = useLocation();
  const currentStep = steps.find(s => s.status === "in_progress") ?? steps.find(s => s.status === "pending");
  const completedCount = steps.filter(s => s.status === "completed").length;
  const eta = project.endDate ? new Date(project.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  let actionBtn = { label: "Details", icon: "open_in_new" };
  if (project.status === "completed") actionBtn = { label: "Archive", icon: "archive" };
  else if (project.status === "on_hold") actionBtn = { label: "Resume", icon: "play_arrow" };

  return (
    <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden hover:shadow-sm transition-shadow">
      <div className="px-5 pt-4 pb-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${trackColor}18` }}>
              <MatIcon name="dataset" className="text-sm" style={{ color: trackColor } as React.CSSProperties} />
            </div>
            <p className="font-semibold text-[#E6EDF3] text-sm leading-tight truncate">{project.title}</p>
          </div>
          <StatusBadge status={project.status} />
        </div>

        <SegmentedBar steps={steps} />

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div>
            <span className="text-muted-foreground">Milestone</span>
            <p className="font-medium text-[#E6EDF3] truncate">{currentStep?.title ?? project.phase ?? "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Next Action</span>
            <p className="font-medium text-[#E6EDF3] truncate">
              {steps.length > 0 ? `Step ${completedCount + 1} of ${steps.length}` : project.phase ?? "—"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">ETA</span>
            <p className="font-medium text-[#E6EDF3]">{eta}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Progress</span>
            <p className="font-medium text-[#E6EDF3]">{project.progress}%</p>
          </div>
        </div>
      </div>

      <div className="border-t border-border px-5 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onEdit}
            className="text-xs font-medium text-muted-foreground hover:text-[#E6EDF3] transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-xs font-medium text-red-400 hover:text-red-400 transition-colors"
          >
            Delete
          </button>
          {project.clientUserId && (
            <button
              onClick={() => navigate(`/crm/clients/${project.clientUserId}`)}
              className="text-xs font-medium text-[#7D8590] hover:text-[#0078D4] transition-colors"
            >
              Client →
            </button>
          )}
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
  const [, navigate] = useLocation();
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
            <div key={tile.label} className="bg-[#161B22]/5 rounded-lg p-3 border border-white/10">
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
          {project.clientUserId && (
            <button
              onClick={() => navigate(`/crm/clients/${project.clientUserId}`)}
              className="text-xs font-medium text-[#60a5fa]/70 hover:text-[#60a5fa] transition-colors"
            >
              Client →
            </button>
          )}
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
  if (projects.length === 0) return null;
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
            <span className="text-sm font-bold text-[#E6EDF3]">{track.label}</span>
          </div>
          <p className="text-xs text-muted-foreground">{track.description}</p>
        </div>
        <div className="ml-auto">
          <span className="text-xs font-semibold text-muted-foreground bg-[#1C2128] border border-border rounded-full px-2.5 py-0.5">
            {projects.length} {projects.length === 1 ? "engagement" : "engagements"}
          </span>
        </div>
      </div>

      <div className={`grid gap-4 ${isRetainer ? "grid-cols-[repeat(auto-fit,minmax(320px,1fr))]" : "grid-cols-[repeat(auto-fit,minmax(280px,1fr))]"}`}>
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
    </div>
  );
}

function PortfolioHeader() {
  return (
    <div className="mb-8">
      <span className="inline-block text-[10px] font-bold text-[#0078D4] bg-[#0078D4]/10 rounded-full px-3 py-1 uppercase tracking-widest mb-3">
        Global Portfolio
      </span>
      <h2 className="text-2xl font-extrabold text-[#E6EDF3] tracking-tight">Active Services Portfolio</h2>
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
    <div className="mt-8 border border-border rounded-xl bg-[#1C2128] overflow-hidden">
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
        {metrics.map(m => (
          <div key={m.label} className="flex items-center gap-3 px-5 py-4">
            <MatIcon name={m.icon} className="text-2xl text-[#0078D4]" />
            <div>
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-lg font-extrabold text-[#E6EDF3]">{m.value}</p>
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
  workflowTemplateId: string;
}

const EMPTY_FORM: ProjectFormState = {
  title: "", description: "", status: "active", phase: "", progress: 0, clientUserId: "", startDate: "", endDate: "", projectType: "project", workflowTemplateId: "",
};

export default function ProjectsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [projects, setProjects] = useState<ProjectWithSteps[]>([]);
  const [steps, setSteps] = useState<Record<number, WorkflowStep[]>>({});
  const [clients, setClients] = useState<Client[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProjectFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Filter + view state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "on_hold" | "completed">("all");
  const [viewMode, setViewMode] = useState<"card" | "list">("card");

  const load = async () => {
    const [projRes, clientRes, tmplRes] = await Promise.all([
      fetchWithAuth("/api/admin/projects"),
      fetchWithAuth("/api/admin/clients"),
      fetchWithAuth("/api/admin/workflow-templates"),
    ]);
    if (clientRes.ok) setClients(await clientRes.json() as Client[]);
    if (tmplRes.ok) setWorkflowTemplates(await tmplRes.json() as WorkflowTemplate[]);
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
        workflowTemplateId: form.workflowTemplateId ? Number(form.workflowTemplateId) : null,
      };
      let res: Response;
      if (editingId) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { workflowTemplateId: _wt, ...editPayload } = payload;
        res = await fetchWithAuth(`/api/admin/projects/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editPayload),
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
      workflowTemplateId: "",
    });
    setShowForm(true);
  };

  const byType = (type: string | string[]) => {
    const statusMatch = (p: ProjectWithSteps) =>
      statusFilter === "all" ? true : p.status === statusFilter;
    const searchMatch = (p: ProjectWithSteps) =>
      !search.trim() ? true : (
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        (p.description ?? "").toLowerCase().includes(search.toLowerCase())
      );
    return projects.filter(p =>
      (Array.isArray(type) ? type.includes(p.projectType) : p.projectType === type) &&
      statusMatch(p) &&
      searchMatch(p)
    );
  };

  const filteredProjects = projects.filter(p => {
    const statusMatch = statusFilter === "all" ? true : p.status === statusFilter;
    const searchMatch = !search.trim() ? true : (
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? "").toLowerCase().includes(search.toLowerCase())
    );
    return statusMatch && searchMatch;
  });

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage client projects grouped by engagement track. Click <strong>Details</strong> to open the kanban board.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/crm/status-reports")}
            className="flex items-center gap-2 border border-border text-[#E6EDF3] text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#1C2128] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Status Reports
          </button>
          <button
            onClick={() => navigate("/crm/documents")}
            className="flex items-center gap-2 border border-border text-[#E6EDF3] text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#1C2128] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Documents
          </button>
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
      </div>

      {showForm && (
        <div className="bg-[#1C2128] border border-border rounded-xl p-5 mb-6">
          <h3 className="text-sm font-bold text-[#E6EDF3] mb-4">{editingId ? "Edit Project" : "New Project"}</h3>
          <form onSubmit={e => void handleSubmit(e)} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Title *</label>
              <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Description</label>
              <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3] resize-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Client</label>
              <select value={form.clientUserId} onChange={e => setForm(f => ({ ...f, clientUserId: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]">
                <option value="">— Unassigned —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name ?? c.email}{c.company ? ` (${c.company})` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Type</label>
              <select value={form.projectType} onChange={e => setForm(f => ({ ...f, projectType: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]">
                <option value="project">Project-Based</option>
                <option value="retainer">Monthly Retainer</option>
              </select>
            </div>
            {!editingId && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">
                  Workflow Template
                  <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">(auto-provisions steps + tasks for the first stage)</span>
                </label>
                <select value={form.workflowTemplateId} onChange={e => setForm(f => ({ ...f, workflowTemplateId: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]">
                  <option value="">— No workflow (blank project) —</option>
                  {workflowTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ""}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]">
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Phase</label>
              <input value={form.phase} onChange={e => setForm(f => ({ ...f, phase: e.target.value }))}
                placeholder="e.g. Pilot Phase" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Progress ({form.progress}%)</label>
              <input type="range" min={0} max={100} value={form.progress} onChange={e => setForm(f => ({ ...f, progress: Number(e.target.value) }))}
                className="w-full accent-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Start Date</label>
              <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Target End Date</label>
              <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            {error && (
              <div className="sm:col-span-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
            )}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : editingId ? "Save Changes" : "Create Project"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setError(""); }}
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#1C2128] transition-colors">
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
      ) : projects.length === 0 ? (
        <div className="bg-[#161B22] border border-border rounded-xl py-24 flex flex-col items-center text-center gap-2">
          <div className="w-14 h-14 rounded-full bg-[#0078D4]/10 flex items-center justify-center mb-2">
            <svg className="w-7 h-7 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
          </div>
          <p className="font-semibold text-[#E6EDF3]">No projects yet</p>
          <p className="text-sm text-muted-foreground max-w-sm mb-3">Create your first project to start tracking client engagements across delivery tracks.</p>
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
      ) : (
        <>
          {/* ── KPI Banner ── */}
          <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(() => {
              const active = filteredProjects.filter(p => p.status === "active").length;
              const onHold = filteredProjects.filter(p => p.status === "on_hold").length;
              const done = filteredProjects.filter(p => p.status === "completed").length;
              const avg = filteredProjects.length > 0 ? Math.round(filteredProjects.reduce((s, p) => s + p.progress, 0) / filteredProjects.length) : 0;
              return [
                { label: "Active", value: String(active), color: "text-emerald-400" },
                { label: "On Hold", value: String(onHold), color: "text-amber-400" },
                { label: "Completed", value: String(done), color: "text-[#7D8590]" },
                { label: "Avg Progress", value: `${avg}%`, color: "text-[#0078D4]" },
              ].map(m => (
                <div key={m.label} className="bg-[#161B22] border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                  <span className={`text-xl font-black ${m.color}`}>{m.value}</span>
                  <span className="text-xs text-muted-foreground">{m.label}</span>
                </div>
              ));
            })()}
          </div>

          {/* ── Filter bar ── */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search projects…"
                className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm bg-[#161B22] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
              />
            </div>
            <div className="flex gap-1 bg-[#161B22] border border-border rounded-lg p-1">
              {(["all", "active", "on_hold", "completed"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${
                    statusFilter === s
                      ? "bg-[#0078D4] text-white"
                      : "text-muted-foreground hover:text-[#E6EDF3]"
                  }`}
                >
                  {s === "all" ? "All" : s === "on_hold" ? "On Hold" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex gap-1 bg-[#161B22] border border-border rounded-lg p-1 ml-auto">
              <button
                onClick={() => setViewMode("card")}
                title="Card view"
                className={`p-1.5 rounded transition-colors ${viewMode === "card" ? "bg-[#0078D4]/20 text-[#0078D4]" : "text-muted-foreground hover:text-[#E6EDF3]"}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("list")}
                title="List view"
                className={`p-1.5 rounded transition-colors ${viewMode === "list" ? "bg-[#0078D4]/20 text-[#0078D4]" : "text-muted-foreground hover:text-[#E6EDF3]"}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>

          <PortfolioHeader />

          {viewMode === "list" ? (
            <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#1C2128] border-b border-border">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Project</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Type</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Status</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Progress</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Phase</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground text-sm">No projects match your filters.</td>
                    </tr>
                  ) : (
                    filteredProjects.map(p => {
                      const statusCls: Record<string, string> = {
                        active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
                        on_hold: "bg-amber-500/15 text-amber-400 border-amber-500/20",
                        completed: "bg-[#30363D] text-[#7D8590] border-[#30363D]",
                      };
                      const statusLabel: Record<string, string> = { active: "Active", on_hold: "On Hold", completed: "Done" };
                      return (
                        <tr key={p.id} className="border-b border-border last:border-0 hover:bg-[#1C2128] transition-colors">
                          <td className="px-5 py-3.5">
                            <p className="font-semibold text-[#E6EDF3] truncate max-w-[200px]">{p.title}</p>
                            {p.description && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{p.description}</p>}
                          </td>
                          <td className="px-4 py-3.5 hidden sm:table-cell">
                            <span className="text-xs text-muted-foreground">{p.projectType === "retainer" ? "Retainer" : "Project"}</span>
                          </td>
                          <td className="px-4 py-3.5 text-center hidden md:table-cell">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${statusCls[p.status] ?? "bg-[#30363D] text-[#7D8590] border-[#30363D]"}`}>
                              {statusLabel[p.status] ?? p.status}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-center hidden md:table-cell">
                            <div className="flex items-center gap-2 justify-center">
                              <div className="w-20 h-1.5 bg-[#30363D] rounded-full overflow-hidden">
                                <div className="h-full bg-[#0078D4] rounded-full" style={{ width: `${p.progress}%` }} />
                              </div>
                              <span className="text-xs tabular-nums text-muted-foreground">{p.progress}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 hidden lg:table-cell">
                            <span className="text-xs text-muted-foreground">{p.phase ?? "—"}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <button
                              onClick={() => navigate(`/crm/projects/${p.id}`)}
                              className="text-xs font-semibold text-[#0078D4] hover:underline"
                            >
                              Details →
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-10">
              {TRACKS.map(track => (
                <TrackSection
                  key={track.num}
                  track={track}
                  projects={byType(track.type)}
                  steps={steps}
                  onDetails={id => navigate(`/crm/projects/${id}`)}
                  onEdit={p => handleEdit(p)}
                  onDelete={p => setDeleteTarget(p)}
                />
              ))}
            </div>
          )}

          <PortfolioFooterBar projects={filteredProjects} />
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
