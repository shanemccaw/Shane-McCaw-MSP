import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

interface StepSummary {
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
  projectType: string;
  phase: string | null;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  stepCount: number;
  currentStepIndex: number;
  currentStepTitle: string | null;
  steps: StepSummary[];
}

function SegmentedStepBar({ steps, currentStepIndex }: { steps: StepSummary[]; currentStepIndex: number }) {
  if (steps.length === 0) return null;
  return (
    <div className="flex gap-1.5">
      {steps.map((step, idx) => {
        const completed = step.status === "completed";
        const active = step.status === "in_progress";
        return (
          <div
            key={step.id}
            title={step.title}
            className={`h-1.5 flex-1 rounded-full transition-all ${
              completed
                ? "bg-[#0078D4]"
                : active
                  ? "bg-[#0078D4]/40 border border-[#0078D4] animate-pulse"
                  : idx < currentStepIndex
                    ? "bg-[#0078D4]"
                    : "bg-gray-200"
            }`}
          />
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:    "bg-[#0078D4]/10 text-[#0078D4]",
    on_hold:   "bg-yellow-100 text-yellow-700",
    completed: "bg-green-100 text-green-700",
  };
  const label: Record<string, string> = {
    active: "Active", on_hold: "On Hold", completed: "Completed",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${map[status] ?? "bg-gray-100 text-gray-500"}`}>
      {label[status] ?? status}
    </span>
  );
}

function ProjectIcon({ type }: { type: string }) {
  if (type === "retainer") {
    return (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    );
  }
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const completedSteps = project.steps.filter(s => s.status === "completed").length;
  const totalSteps = project.steps.length;

  return (
    <Link href={`/portal/projects/${project.id}`}>
      <article className="bg-white rounded-xl p-6 border border-gray-100 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 cursor-pointer group"
        style={{ boxShadow: "0 2px 10px rgba(15,23,42,0.04)" }}>
        <div className="space-y-5">

          {/* Card header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#0078D4]/8 flex items-center justify-center text-[#0078D4] flex-shrink-0">
                <ProjectIcon type={project.projectType} />
              </div>
              <div>
                <h4 className="text-[15px] font-bold text-[#0A2540] group-hover:text-[#0078D4] transition-colors leading-snug">
                  {project.title}
                </h4>
                <div className="flex items-center gap-2 mt-1">
                  <StatusBadge status={project.status} />
                </div>
              </div>
            </div>
            <span className="text-xs font-semibold text-[#0078D4] flex-shrink-0 group-hover:underline">
              View →
            </span>
          </div>

          {/* Step progress */}
          <div className="space-y-3">
            <div className="flex justify-between items-end">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                {totalSteps > 0
                  ? `Phase ${completedSteps + 1} of ${totalSteps}${project.currentStepTitle ? `: ${project.currentStepTitle}` : ""}`
                  : project.phase ?? "In Progress"}
              </span>
              <span className="text-[11px] font-mono font-semibold text-[#0078D4]">
                {project.progress}% Complete
              </span>
            </div>
            {project.steps.length > 0 ? (
              <SegmentedStepBar steps={project.steps} currentStepIndex={project.currentStepIndex} />
            ) : (
              <div className="w-full h-1.5 bg-gray-100 rounded-full">
                <div className="h-1.5 bg-[#0078D4] rounded-full transition-all" style={{ width: `${project.progress}%` }} />
              </div>
            )}
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Current Phase</p>
              <p className="text-[13px] font-semibold text-[#0A2540] leading-snug truncate">
                {project.currentStepTitle ?? project.phase ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Progress</p>
              <p className="text-[13px] font-semibold text-[#0A2540]">{project.progress}%</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Target Date</p>
              <p className="text-[13px] font-semibold text-[#0A2540]">
                {project.endDate
                  ? new Date(project.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Status</p>
              <p className={`text-[13px] font-semibold ${project.status === "active" ? "text-[#0078D4]" : project.status === "completed" ? "text-green-600" : "text-yellow-600"}`}>
                {project.status === "active" ? "On Schedule" : project.status === "completed" ? "Completed" : "On Hold"}
              </p>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

function RetainerCard({ project }: { project: Project }) {
  return (
    <Link href={`/portal/projects/${project.id}`}>
      <article
        className="rounded-xl p-8 overflow-hidden relative cursor-pointer group hover:-translate-y-0.5 transition-all duration-200"
        style={{ background: "#0A2540", boxShadow: "0 8px 32px rgba(10,37,64,0.25)" }}
      >
        {/* Decorative blobs */}
        <div className="absolute -right-20 -top-20 w-64 h-64 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(0,180,216,0.07)" }} />
        <div className="absolute -left-20 -bottom-20 w-64 h-64 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(0,120,212,0.05)" }} />

        <div className="relative z-10 flex flex-col lg:flex-row gap-10">
          {/* Left: identity & features */}
          <div className="lg:w-3/5 space-y-6">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[10px] font-mono bg-[#00B4D8]/20 text-[#00B4D8] px-2 py-1 rounded tracking-widest uppercase">
                  Retainer Advisory
                </span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <h4 className="text-xl font-bold text-white leading-tight group-hover:text-[#00B4D8] transition-colors">
                {project.title}
              </h4>
              {project.description && (
                <p className="text-sm text-white/60 mt-2 leading-relaxed">{project.description}</p>
              )}
            </div>

            {/* Benefits */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5">
              {[
                "Architecture leadership",
                "Governance program management",
                "Security & compliance oversight",
                "Vendor & Microsoft liaison",
                "Priority access & SLA",
                "Monthly strategy sessions",
              ].map(item => (
                <div key={item} className="flex items-center gap-2 text-sm text-white/70">
                  <svg className="w-4 h-4 text-[#00B4D8] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                  </svg>
                  <span>{item}</span>
                </div>
              ))}
            </div>

            {/* Advisor identity */}
            <div className="flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/5 w-fit">
              <div className="w-10 h-10 rounded-full bg-[#0078D4]/30 flex items-center justify-center text-white font-bold text-sm">SM</div>
              <div>
                <p className="text-[10px] uppercase text-white/50 tracking-wider font-semibold">Strategic Advisor</p>
                <p className="text-sm font-semibold text-white">Shane McCaw</p>
              </div>
            </div>

            <div className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-xs font-bold uppercase tracking-widest transition-all"
              style={{ background: "#00B4D8", color: "#0A2540" }}>
              View Retainer Dashboard
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
          </div>

          {/* Right: metrics grid */}
          <div className="lg:w-2/5 grid grid-cols-2 gap-4 content-start">
            {/* Progress ring */}
            <div className="bg-white/5 p-5 rounded-2xl border border-white/10 flex flex-col items-center justify-center text-center">
              <div className="relative w-16 h-16 flex items-center justify-center mb-2">
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="28" fill="transparent" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
                  <circle
                    cx="32" cy="32" r="28"
                    fill="transparent"
                    stroke="#00B4D8"
                    strokeWidth="4"
                    strokeDasharray={`${2 * Math.PI * 28}`}
                    strokeDashoffset={`${2 * Math.PI * 28 * (1 - project.progress / 100)}`}
                  />
                </svg>
                <span className="text-lg font-bold text-white">{project.progress}</span>
              </div>
              <p className="text-[10px] font-bold uppercase text-white/50 tracking-widest">Overall Progress</p>
              <p className="text-[10px] text-[#00B4D8] mt-0.5">+Active</p>
            </div>

            {/* Current phase */}
            <div className="bg-white/5 p-5 rounded-2xl border border-white/10 flex flex-col justify-between">
              <svg className="w-5 h-5 text-[#00B4D8] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-base font-bold text-white leading-tight">{project.currentStepTitle ?? project.phase ?? "Active"}</p>
                <p className="text-[10px] font-bold uppercase text-white/50 tracking-widest mt-1">Current Phase</p>
              </div>
            </div>

            {/* Step count */}
            <div className="bg-white/5 p-5 rounded-2xl border border-white/10 flex flex-col justify-between">
              <svg className="w-5 h-5 text-[#00B4D8] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
              </svg>
              <div>
                <p className="text-2xl font-bold text-white">{project.stepCount > 0 ? String(project.currentStepIndex + 1).padStart(2, "0") : "—"}</p>
                <p className="text-[10px] font-bold uppercase text-white/50 tracking-widest">of {String(project.stepCount).padStart(2, "0")} Phases</p>
              </div>
            </div>

            {/* Priority status */}
            <div className="bg-white/5 p-5 rounded-2xl border border-white/10 flex flex-col justify-between">
              <svg className="w-5 h-5 text-[#00B4D8] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <div>
                <p className="text-sm font-bold text-white leading-tight">Priority Access</p>
                <p className="text-[10px] font-bold uppercase text-white/50 tracking-widest mt-1">SLA Active</p>
              </div>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

function TrackHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-4 border-b border-gray-100 pb-5">
      <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center text-[#0078D4] flex-shrink-0">
        {icon}
      </div>
      <div>
        <h3 className="text-[15px] font-bold text-[#0A2540]">{title}</h3>
        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
    </div>
  );
}

export default function PortalProjects() {
  const { fetchWithAuth } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/portal/projects")
      .then(r => r.json())
      .then(d => setProjects(d as Project[]))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  const activeProjects = projects.filter(p => p.status !== "completed");
  const retainers = activeProjects.filter(p => p.projectType === "retainer");
  const engagements = activeProjects.filter(p => p.projectType !== "retainer");

  const avgProgress = activeProjects.length > 0
    ? Math.round(activeProjects.reduce((s, p) => s + p.progress, 0) / activeProjects.length)
    : 0;

  return (
    <PortalLayout>
      <div className="px-4 sm:px-6 py-6 sm:py-10 max-w-5xl mx-auto">

        {/* Page header */}
        <div className="mb-12">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <div>
              <span className="inline-block bg-[#00B4D8]/15 text-[#0078D4] font-mono text-[10px] px-2 py-0.5 rounded uppercase tracking-widest mb-2">
                Global Portfolio
              </span>
              <h2 className="text-2xl font-bold text-[#0A2540] tracking-tight">Active Services Portfolio</h2>
            </div>
            <Link href="/portal/book-meeting">
              <span className="inline-flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-[#0078D4]/90 transition-colors cursor-pointer flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                Book a Meeting
              </span>
            </Link>
          </div>
          <div className="h-px w-full bg-gray-100" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activeProjects.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-16 text-center"
            style={{ boxShadow: "0 2px 10px rgba(15,23,42,0.04)" }}>
            <div className="w-14 h-14 rounded-xl bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </div>
            <h3 className="text-[#0A2540] font-bold mb-1">No projects yet</h3>
            <p className="text-gray-500 text-sm">Your projects will appear here once Shane sets them up.</p>
          </div>
        ) : (
          <div className="space-y-16">

            {/* Track 01 — Project Engagements */}
            {engagements.length > 0 && (
              <section className="space-y-6">
                <TrackHeader
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                    </svg>
                  }
                  title={`Track 0${retainers.length > 0 ? "1" : "1"}: Project Engagements`}
                  subtitle="Complex implementations and focused modernization efforts."
                />
                <div className="grid grid-cols-1 gap-5">
                  {engagements.map(p => <ProjectCard key={p.id} project={p} />)}
                </div>
              </section>
            )}

            {/* Track 02 — Retainer Advisory */}
            {retainers.length > 0 && (
              <section className="space-y-6">
                <TrackHeader
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                    </svg>
                  }
                  title="Track 03: Retainer Advisory"
                  subtitle="Ongoing strategic advisory and priority technical oversight."
                />
                <div className="grid grid-cols-1 gap-5">
                  {retainers.map(p => <RetainerCard key={p.id} project={p} />)}
                </div>
              </section>
            )}

          </div>
        )}

        {/* Footer metric bar */}
        {!loading && activeProjects.length > 0 && (
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8 border-t border-gray-100 pt-10 pb-6">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Active Engagements</span>
              <span className="text-2xl font-bold text-[#0A2540]">{String(activeProjects.filter(p => p.status === "active").length).padStart(2, "0")}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Avg. Progress</span>
              <span className="text-2xl font-bold text-[#0078D4]">{avgProgress}%</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Phases</span>
              <span className="text-2xl font-bold text-[#0A2540]">
                {String(activeProjects.reduce((s, p) => s + p.stepCount, 0)).padStart(2, "0")}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Retainer Status</span>
              <span className={`text-2xl font-bold ${retainers.length > 0 ? "text-[#00B4D8]" : "text-gray-300"}`}>
                {retainers.length > 0 ? "Active" : "None"}
              </span>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
