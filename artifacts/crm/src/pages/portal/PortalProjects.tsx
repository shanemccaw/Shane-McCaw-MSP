import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

interface Project {
  id: number;
  title: string;
  description: string | null;
  status: string;
  phase: string | null;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  on_hold: "bg-yellow-100 text-yellow-700 border-yellow-200",
  completed: "bg-blue-100 text-blue-700 border-blue-200",
};

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-[#F7F9FC] rounded-full h-2">
      <div
        className="h-2 rounded-full bg-[#0078D4] transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
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

  const active = projects.filter(p => p.status === "active");
  const others = projects.filter(p => p.status !== "active");

  return (
    <PortalLayout>
      <div className="px-6 py-8 max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-[#0A2540]">Projects</h1>
          <p className="text-muted-foreground text-sm mt-1">All your consulting projects and their current status.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-white border border-border rounded-xl p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-[#0A2540] font-bold mb-2">No projects yet</h3>
            <p className="text-muted-foreground text-sm">Your projects will appear here once Shane sets them up.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {active.length > 0 && (
              <section>
                <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-4">Active</h2>
                <div className="space-y-4">
                  {active.map(p => (
                    <Link key={p.id} href={`/portal/projects/${p.id}`}>
                      <div className="bg-white border border-border rounded-xl p-6 hover:border-[#0078D4]/40 hover:shadow-md transition-all cursor-pointer group">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base font-bold text-[#0A2540] group-hover:text-[#0078D4] transition-colors">{p.title}</h3>
                            {p.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{p.description}</p>}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {p.phase && <span className="text-xs bg-[#0078D4]/10 text-[#0078D4] font-medium px-2.5 py-1 rounded-full">{p.phase}</span>}
                            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                              {p.status.replace("_", " ")}
                            </span>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Overall Progress</span>
                            <span className="font-bold text-[#0078D4]">{p.progress}%</span>
                          </div>
                          <ProgressBar value={p.progress} />
                        </div>
                        {(p.startDate || p.endDate) && (
                          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                            {p.startDate && <span>Started {new Date(p.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                            {p.endDate && <span>Target {new Date(p.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {others.length > 0 && (
              <section>
                <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-4">Other</h2>
                <div className="space-y-3">
                  {others.map(p => (
                    <Link key={p.id} href={`/portal/projects/${p.id}`}>
                      <div className="bg-white border border-border rounded-xl p-5 hover:border-[#0078D4]/40 transition-all cursor-pointer flex items-center gap-4 group">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-[#0A2540] group-hover:text-[#0078D4] transition-colors truncate">{p.title}</h3>
                          {p.phase && <p className="text-xs text-muted-foreground mt-0.5">{p.phase}</p>}
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="w-20">
                            <ProgressBar value={p.progress} />
                            <p className="text-xs text-muted-foreground text-right mt-0.5">{p.progress}%</p>
                          </div>
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                            {p.status.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
