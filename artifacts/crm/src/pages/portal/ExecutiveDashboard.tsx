import { useState, useEffect, useMemo } from "react";
import PortalLayout from "@/components/PortalLayout";
import { useAuth } from "@/contexts/AuthContext";
import {
  StatusBadge,
  ExecProgressBar,
  ExecCard,
  KpiTile,
  KpiSkeleton,
  CardSkeleton,
} from "@/components/ExecutivePrecisionComponents";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardSummary {
  projects: { id: number; title: string; status: string; phase: string | null; progress: number; endDate: string | null }[];
  clientServices: { cs: { id: number; status: string }; service: { id: number; name: string } }[];
  invoices: { id: number; status: string }[];
  unreadMessages: number;
}

interface Project {
  id: number;
  title: string;
  status: string;
  phase: string | null;
  progress: number;
  endDate: string | null;
  startDate: string | null;
}

interface KanbanTask {
  id: number;
  title: string;
  column: "backlog" | "in_progress" | "waiting_on_customer" | "completed";
  order: number;
}

const KANBAN_COLUMNS: { key: KanbanTask["column"]; label: string }[] = [
  { key: "backlog",             label: "Backlog" },
  { key: "in_progress",        label: "In Progress" },
  { key: "waiting_on_customer", label: "Waiting on Client" },
  { key: "completed",          label: "Completed" },
];

// ─── Icons ───────────────────────────────────────────────────────────────────

function IconBriefcase() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function IconCog() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function IconReceipt() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-bold text-[#0f172a]">{title}</h2>
      {subtitle && <p className="text-xs text-[#64748b] mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ─── Kanban task card ─────────────────────────────────────────────────────────

function KanbanCard({ task }: { task: KanbanTask }) {
  return (
    <div
      className="bg-white rounded-lg px-3.5 py-3 flex flex-col gap-1.5"
      style={{ boxShadow: "0 1px 6px rgba(15,23,42,0.06)", borderRadius: 10 }}
    >
      <p className="text-[13px] font-semibold text-[#0f172a] leading-snug">{task.title}</p>
      <StatusBadge status={task.column} />
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-10 h-10 rounded-full bg-[#f0fdfb] flex items-center justify-center mb-3">
        <svg className="w-5 h-5 text-[#0c9488]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <p className="text-sm text-[#64748b] font-medium">{message}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ExecutiveDashboard() {
  const { fetchWithAuth } = useAuth();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [kanbanTasks, setKanbanTasks] = useState<KanbanTask[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [summaryLoading, setSummaryLoading] = useState(true);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [kanbanLoading, setKanbanLoading] = useState(false);

  useEffect(() => {
    fetchWithAuth("/api/portal/dashboard")
      .then(r => r.json())
      .then(d => setSummary(d as DashboardSummary))
      .catch(() => null)
      .finally(() => setSummaryLoading(false));

    fetchWithAuth("/api/portal/projects")
      .then(r => r.json())
      .then(d => setProjects(d as Project[]))
      .catch(() => null)
      .finally(() => setProjectsLoading(false));
  }, [fetchWithAuth]);

  useEffect(() => {
    if (!projects) return;
    const activeProject = projects.find(p => p.status === "active") ?? projects[0];
    if (!activeProject) { setKanbanTasks([]); return; }

    setKanbanLoading(true);
    fetchWithAuth(`/api/portal/projects/${activeProject.id}`)
      .then(r => r.json())
      .then((d: { tasks?: KanbanTask[] }) => setKanbanTasks(d.tasks ?? []))
      .catch(() => setKanbanTasks([]))
      .finally(() => setKanbanLoading(false));
  }, [projects, fetchWithAuth]);

  const activeProjectsCount = summary?.projects?.length ?? 0;
  const activeServicesCount = summary?.clientServices?.length ?? 0;
  const openInvoicesCount = summary?.invoices?.filter(i => i.status === "due" || i.status === "overdue").length ?? 0;
  const unreadMessages = summary?.unreadMessages ?? 0;

  const filteredTasks = useMemo(() => {
    if (!kanbanTasks) return null;
    if (!searchQuery.trim()) return kanbanTasks;
    const q = searchQuery.toLowerCase();
    return kanbanTasks.filter(t => t.title.toLowerCase().includes(q));
  }, [kanbanTasks, searchQuery]);

  return (
    <PortalLayout unreadMessages={summary?.unreadMessages}>
      <div className="ep-root px-6 py-8 max-w-7xl mx-auto">

        {/* ── Page header ─────────────────────────────────────────── */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-[#0f172a] tracking-tight">Executive Dashboard</h1>
          <p className="text-sm text-[#64748b] mt-1">A high-density overview of your projects, tasks, and account health.</p>
        </div>

        {/* ── KPI tiles ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {summaryLoading ? (
            <>
              <KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton />
            </>
          ) : (
            <>
              <KpiTile label="Active Projects"  value={activeProjectsCount}  icon={<IconBriefcase />} accent="#0c9488" />
              <KpiTile label="Active Services"  value={activeServicesCount}  icon={<IconCog />}       accent="#0078D4" />
              <KpiTile label="Open Invoices"    value={openInvoicesCount}    icon={<IconReceipt />}   accent="#d97706" />
              <KpiTile label="Unread Messages"  value={unreadMessages}       icon={<IconChat />}      accent="#7c3aed" />
            </>
          )}
        </div>

        {/* ── Project card grid ────────────────────────────────────── */}
        <section className="mb-10">
          <SectionHeading title="Projects" subtitle="One card per active project — click any card for full detail." />
          {projectsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <CardSkeleton /><CardSkeleton /><CardSkeleton />
            </div>
          ) : !projects || projects.length === 0 ? (
            <div className="bg-white rounded-xl" style={{ boxShadow: "0 2px 10px rgba(15,23,42,0.06)" }}>
              <EmptyState message="No projects yet — Shane will set them up shortly." />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {projects.map(p => (
                <ExecCard
                  key={p.id}
                  title={p.title}
                  status={p.status}
                  phase={p.phase}
                  progress={p.progress}
                  deadline={p.endDate}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Kanban board ─────────────────────────────────────────── */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <SectionHeading
              title="Task Board"
              subtitle="Tasks from your first active project, filtered in real time."
            />
            <div className="relative w-full sm:w-64 flex-shrink-0 mb-5 sm:mb-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]">
                <IconSearch />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search tasks…"
                className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-[#e2e8f0] bg-white text-[#0f172a] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#0c9488]/30 focus:border-[#0c9488]"
                style={{ boxShadow: "0 1px 4px rgba(15,23,42,0.04)" }}
              />
            </div>
          </div>

          {kanbanLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {KANBAN_COLUMNS.map(col => (
                <div key={col.key} className="bg-[#f8fafc] rounded-xl p-4 border border-dashed border-[#cbd5e1] animate-pulse">
                  <div className="h-4 w-24 bg-[#e2e8f0] rounded mb-4" />
                  <div className="space-y-3">
                    <div className="h-16 bg-[#e2e8f0] rounded-lg" />
                    <div className="h-16 bg-[#e2e8f0] rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : !filteredTasks || (projects && projects.length === 0) ? (
            <div className="bg-white rounded-xl" style={{ boxShadow: "0 2px 10px rgba(15,23,42,0.06)" }}>
              <EmptyState message="No tasks yet — they'll appear here once a project is underway." />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {KANBAN_COLUMNS.map(col => {
                const colTasks = filteredTasks.filter(t => t.column === col.key);
                return (
                  <div
                    key={col.key}
                    className="rounded-xl p-4 border border-dashed border-[#cbd5e1] bg-[#f8fafc] flex flex-col gap-3 min-h-[180px]"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-[#64748b]">{col.label}</span>
                      <span className="text-[11px] font-bold text-[#0c9488] bg-[#f0fdfb] px-1.5 py-0.5 rounded-full">{colTasks.length}</span>
                    </div>
                    {colTasks.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center">
                        <p className="text-[11px] text-[#94a3b8] italic">
                          {searchQuery ? "No matches" : "No tasks"}
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        {colTasks.map(task => (
                          <KanbanCard key={task.id} task={task} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </PortalLayout>
  );
}
