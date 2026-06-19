import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

interface Service {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  deliverables: string | null;
  durationDays: number | null;
}

interface WorkflowStep {
  id: number;
  title: string;
  status: string;
  description: string | null;
  completedAt: string | null;
  order: number;
}

interface ClientService {
  id: number;
  status: string;
  progress: number;
  startDate: string | null;
  nextMilestone: string | null;
  nextMilestoneDate: string | null;
  purchasedAt: string;
  service: Service;
  steps: WorkflowStep[];
}

const STEP_STATUS: Record<string, { color: string; icon: React.ReactNode }> = {
  completed: {
    color: "bg-green-500",
    icon: <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>,
  },
  in_progress: {
    color: "bg-[#0078D4]",
    icon: <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  },
  blocked: {
    color: "bg-red-500",
    icon: <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>,
  },
  pending: {
    color: "bg-gray-200",
    icon: <svg className="w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /></svg>,
  },
};

const BOOKINGS_URL = import.meta.env.VITE_BOOKINGS_URL as string | undefined;

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-[#F7F9FC] rounded-full h-2">
      <div className="h-2 rounded-full bg-[#0078D4] transition-all duration-500" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

function ServiceCard({ cs }: { cs: ClientService }) {
  const [expanded, setExpanded] = useState(false);
  const completedSteps = cs.steps.filter(s => s.status === "completed").length;

  return (
    <div className="bg-white border border-border rounded-xl overflow-hidden">
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {cs.service.category && (
                <span className="text-xs bg-[#0078D4]/10 text-[#0078D4] font-semibold px-2.5 py-1 rounded-full">{cs.service.category}</span>
              )}
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${
                cs.status === "completed" ? "bg-green-100 text-green-700" :
                cs.status === "active" ? "bg-blue-100 text-blue-700" :
                "bg-yellow-100 text-yellow-700"
              }`}>{cs.status}</span>
            </div>
            <h3 className="text-base font-bold text-[#0A2540]">{cs.service.name}</h3>
            {cs.service.description && <p className="text-sm text-muted-foreground mt-1">{cs.service.description}</p>}
          </div>
          <a
            href={BOOKINGS_URL ?? "mailto:info@shanemccaw.com"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 bg-[#0078D4] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Book Meeting
          </a>
        </div>

        {/* Progress */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>Progress</span>
            <span className="font-bold text-[#0078D4]">{cs.progress}%</span>
          </div>
          <ProgressBar value={cs.progress} />
          {cs.steps.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">{completedSteps} of {cs.steps.length} workflow steps complete</p>
          )}
        </div>

        {/* Next milestone */}
        {cs.nextMilestone && (
          <div className="bg-[#0078D4]/5 border border-[#0078D4]/20 rounded-lg px-4 py-3 mb-4">
            <p className="text-xs font-bold text-[#0078D4] uppercase tracking-wide mb-0.5">Next Milestone</p>
            <p className="text-sm text-[#0A2540] font-medium">{cs.nextMilestone}</p>
            {cs.nextMilestoneDate && (
              <p className="text-xs text-muted-foreground mt-0.5">Target: {new Date(cs.nextMilestoneDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
            )}
          </div>
        )}

        {/* Deliverables */}
        {cs.service.deliverables && (
          <div className="mb-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Deliverables</p>
            <div className="flex flex-wrap gap-2">
              {cs.service.deliverables.split(",").map((d, i) => (
                <span key={i} className="text-xs bg-[#F7F9FC] border border-border text-[#0A2540] px-2.5 py-1 rounded-full">{d.trim()}</span>
              ))}
            </div>
          </div>
        )}

        {/* Workflow steps accordion */}
        {cs.steps.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-sm font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors"
          >
            <svg className={`w-4 h-4 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {expanded ? "Hide" : "Show"} workflow steps ({cs.steps.length})
          </button>
        )}
      </div>

      {expanded && cs.steps.length > 0 && (
        <div className="border-t border-border bg-[#F7F9FC] px-5 py-4 space-y-3">
          {cs.steps.map((s, idx) => {
            const config = STEP_STATUS[s.status] ?? STEP_STATUS.pending;
            return (
              <div key={s.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center mt-0.5">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}>
                    {config.icon}
                  </div>
                  {idx < cs.steps.length - 1 && <div className="w-0.5 h-4 bg-border mt-0.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${s.status === "completed" ? "line-through text-muted-foreground" : "text-[#0A2540]"}`}>{s.title}</p>
                  {s.description && <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>}
                  {s.completedAt && <p className="text-xs text-green-600 mt-0.5">✓ {new Date(s.completedAt).toLocaleDateString()}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PortalServices() {
  const { fetchWithAuth } = useAuth();
  const [services, setServices] = useState<ClientService[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/portal/services")
      .then(r => r.json())
      .then(d => setServices(d as ClientService[]))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  const active = services.filter(s => s.status === "active");
  const completed = services.filter(s => s.status === "completed");

  return (
    <PortalLayout>
      <div className="px-6 py-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-[#0A2540]">Your Services</h1>
          <p className="text-muted-foreground text-sm mt-1">All purchased consulting services and their delivery progress.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : services.length === 0 ? (
          <div className="bg-white border border-border rounded-xl p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <h3 className="text-[#0A2540] font-bold mb-2">No services yet</h3>
            <p className="text-muted-foreground text-sm">Your purchased services will appear here.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {active.length > 0 && (
              <section>
                <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-4">Active ({active.length})</h2>
                <div className="space-y-4">
                  {active.map(cs => <ServiceCard key={cs.id} cs={cs} />)}
                </div>
              </section>
            )}
            {completed.length > 0 && (
              <section>
                <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-4">Completed ({completed.length})</h2>
                <div className="space-y-4">
                  {completed.map(cs => <ServiceCard key={cs.id} cs={cs} />)}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
