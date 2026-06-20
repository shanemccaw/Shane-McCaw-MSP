import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import StatusReportForm, { type StatusReport as SRType } from "@/components/StatusReportForm";

interface ThreadMessage {
  sender: "client" | "admin";
  content: string;
  timestamp: string;
}

interface StatusReport {
  id: number;
  projectId: number | null;
  clientUserId: number | null;
  title: string;
  period: string;
  reportStatus: string;
  executiveSummary: string | null;
  completedActivities: unknown[];
  keyOutcomes: string | null;
  nextSteps: unknown[];
  reportDate: string | null;
  sentAt: string | null;
  clientStatus?: "pending" | "accepted" | "has_questions";
  clientQuestion?: string | null;
  adminReply?: string | null;
  replyThread?: ThreadMessage[];
  createdAt: string;
  updatedAt: string;
}

interface Project {
  id: number;
  title: string;
}

interface Client {
  id: number;
  name: string | null;
  email: string;
}

const PERIOD_LABELS: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  executive_summary: "Executive Summary",
  other: "Other",
};

export default function StatusReportsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [reports, setReports] = useState<StatusReport[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SRType | null>(null);
  const [isNew, setIsNew] = useState(false);

  const load = useCallback(async () => {
    const [rRes, pRes, cRes] = await Promise.all([
      fetchWithAuth("/api/admin/status-reports"),
      fetchWithAuth("/api/admin/projects"),
      fetchWithAuth("/api/admin/clients"),
    ]);
    if (rRes.ok) {
      const loaded = await rRes.json() as StatusReport[];
      setReports(loaded);
      const params = new URLSearchParams(window.location.search);
      const reportId = params.get("report");
      if (reportId) {
        const found = loaded.find(r => r.id === Number(reportId));
        if (found) {
          setEditing(found as SRType);
          setIsNew(false);
        }
      }
    }
    if (pRes.ok) setProjects(await pRes.json() as Project[]);
    if (cRes.ok) setClients(await cRes.json() as Client[]);
    setLoading(false);
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  const clientName = (id: number | null) => {
    if (!id) return "—";
    const c = clients.find(c => c.id === id);
    return c ? (c.name ?? c.email) : String(id);
  };

  const projectTitle = (id: number | null) => {
    if (!id) return "—";
    const p = projects.find(p => p.id === id);
    return p?.title ?? String(id);
  };

  const openNew = () => {
    setEditing(null);
    setIsNew(true);
  };

  const openEdit = (r: StatusReport) => {
    setEditing(r as SRType);
    setIsNew(false);
  };

  const handleCopyLink = (id: number) => {
    const url = `${window.location.origin}/admin-panel/crm/status-reports?report=${id}`;
    void navigator.clipboard.writeText(url).then(() => {
      toast({ title: "Link copied", description: "Paste it anywhere to open this report directly." });
    });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this status report?")) return;
    await fetchWithAuth(`/api/admin/status-reports/${id}`, { method: "DELETE" });
    await load();
  };

  const handleBack = () => {
    setEditing(null);
    setIsNew(false);
    const params = new URLSearchParams(window.location.search);
    if (params.has("report")) {
      navigate("/crm/status-reports", { replace: true });
    }
  };

  if (!isNew && !editing) {
    return (
      <div className="p-6 max-w-[1200px]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#0A2540]">Status Reports</h1>
            <p className="text-sm text-gray-500 mt-0.5">Create and send structured project status reports to clients.</p>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Status Report
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : reports.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
            <div className="w-12 h-12 bg-[#0078D4]/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-[#0A2540] mb-1">No status reports yet</p>
            <p className="text-xs text-gray-500">Create your first status report to send to a client.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {reports.map(r => (
              <div key={r.id} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
                <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#0A2540] truncate">{r.title}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-500">{projectTitle(r.projectId)}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{clientName(r.clientUserId)}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{PERIOD_LABELS[r.period] ?? r.period}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{new Date(r.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${r.reportStatus === "sent" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                  {r.reportStatus === "sent" ? "Published" : "Draft"}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleCopyLink(r.id)}
                    title="Copy link to this report"
                    className="p-1.5 text-gray-400 hover:text-[#0078D4] rounded hover:bg-[#0078D4]/10 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  </button>
                  <button onClick={() => openEdit(r)} className="text-xs text-[#0078D4] hover:text-[#0078D4]/80 font-semibold transition-colors px-2 py-1 rounded hover:bg-[#0078D4]/10">
                    Edit
                  </button>
                  <button onClick={() => void handleDelete(r.id)} className="text-xs text-red-500 hover:text-red-700 font-semibold transition-colors px-2 py-1 rounded hover:bg-red-50">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#f7f9fb]">
      <div className="max-w-[1280px] mx-auto px-6 py-6">
        {/* Breadcrumb + back */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#0A2540] transition-colors font-medium"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Status Reports
          </button>
          <span className="text-gray-400">/</span>
          <span className="text-sm text-[#0A2540] font-medium">{isNew ? "New Report" : (editing?.title ?? "Edit Report")}</span>
        </div>

        <StatusReportForm
          initialReport={editing ?? undefined}
          onSaved={(saved) => {
            setEditing(saved);
            setIsNew(false);
            void load();
          }}
          onCancel={handleBack}
        />
      </div>
    </div>
  );
}
