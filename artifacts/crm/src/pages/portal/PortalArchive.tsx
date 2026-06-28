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
  stepCount: number;
  currentStepIndex: number;
  currentStepTitle: string | null;
  steps: StepSummary[];
  signedOffAt: string | null;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ArchivedProjectCard({ project }: { project: Project }) {
  const completedSteps = project.steps.filter(s => s.status === "completed").length;
  const totalSteps = project.steps.length;

  return (
    <Link href={`/portal/projects/${project.id}`}>
      <article className="bg-white rounded-xl p-6 border border-gray-100 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 cursor-pointer group"
        style={{ boxShadow: "0 2px 10px rgba(15,23,42,0.04)" }}>
        <div className="space-y-4">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center text-green-600 flex-shrink-0">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h4 className="text-[15px] font-bold text-[#0A2540] group-hover:text-[#0078D4] transition-colors leading-snug">
                  {project.title}
                </h4>
                <div className="flex items-center gap-2 mt-1">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-green-100 text-green-700">
                    Completed
                  </span>
                  {project.projectType === "retainer" && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-[#0A2540]/10 text-[#0A2540]">
                      Retainer
                    </span>
                  )}
                </div>
              </div>
            </div>
            <span className="text-xs font-semibold text-[#0078D4] flex-shrink-0 group-hover:underline">View →</span>
          </div>

          {project.description && (
            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">{project.description}</p>
          )}

          {totalSteps > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                <span>{completedSteps}/{totalSteps} phases</span>
                <span className="text-green-600">{project.progress}% Complete</span>
              </div>
              <div className="flex gap-1">
                {project.steps.map(s => (
                  <div
                    key={s.id}
                    title={s.title}
                    className="h-1.5 flex-1 rounded-full bg-green-500"
                  />
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1 border-t border-gray-50">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Started</p>
              <p className="text-[13px] font-semibold text-[#0A2540]">{formatDate(project.startDate)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Target Date</p>
              <p className="text-[13px] font-semibold text-[#0A2540]">{formatDate(project.endDate)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Signed Off</p>
              <p className="text-[13px] font-semibold text-green-600">{formatDate(project.signedOffAt)}</p>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

export default function PortalArchive() {
  const { fetchWithAuth } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/portal/projects")
      .then(r => r.json())
      .then(d => setProjects(
        (d as Project[]).filter(p => p.status === "completed" && p.signedOffAt != null)
      ))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  return (
    <PortalLayout>
      <div className="px-4 sm:px-6 py-6 sm:py-10 max-w-5xl mx-auto">

        {/* Page header */}
        <div className="mb-12">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <div>
              <span className="inline-block bg-green-100 text-green-700 font-mono text-[10px] px-2 py-0.5 rounded uppercase tracking-widest mb-2">
                Project Archive
              </span>
              <h2 className="text-2xl font-bold text-[#0A2540] tracking-tight">Completed Projects</h2>
              <p className="text-sm text-muted-foreground mt-1">All successfully closed and signed-off engagements.</p>
            </div>
            <Link href="/portal/projects">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#0078D4] hover:underline cursor-pointer flex-shrink-0">
                ← Active Projects
              </span>
            </Link>
          </div>
          <div className="h-px w-full bg-gray-100" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-16 text-center"
            style={{ boxShadow: "0 2px 10px rgba(15,23,42,0.04)" }}>
            <div className="w-14 h-14 rounded-xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </div>
            <h3 className="text-[#0A2540] font-bold mb-1">No archived projects</h3>
            <p className="text-gray-500 text-sm">Projects appear here after they are completed and signed off.</p>
            <Link href="/portal/projects">
              <span className="mt-4 inline-block text-sm font-semibold text-[#0078D4] hover:underline cursor-pointer">
                View active projects →
              </span>
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            {projects.map(p => <ArchivedProjectCard key={p.id} project={p} />)}
          </div>
        )}

        {!loading && projects.length > 0 && (
          <div className="mt-16 grid grid-cols-2 md:grid-cols-3 gap-8 border-t border-gray-100 pt-10 pb-6">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Completed Projects</span>
              <span className="text-2xl font-bold text-[#0A2540]">{String(projects.length).padStart(2, "0")}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Phases</span>
              <span className="text-2xl font-bold text-[#0A2540]">
                {String(projects.reduce((s, p) => s + p.stepCount, 0)).padStart(2, "0")}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Avg. Completion</span>
              <span className="text-2xl font-bold text-green-600">
                {Math.round(projects.reduce((s, p) => s + p.progress, 0) / projects.length)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
