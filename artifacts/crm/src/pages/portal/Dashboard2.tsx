import { useState, useEffect, useCallback } from "react";
import PortalLayout from "@/components/PortalLayout";
import { useAuth } from "@/contexts/AuthContext";

// ─── Types ─────────────────────────────────────────────────────────────────

interface WorkflowStep {
  id: number;
  title: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  order: number;
}

interface ClientService {
  id: number;
  serviceId: number;
  projectId: number | null;
  status: string;
  progress: number;
  purchasedAt: string;
  service: { id: number; name: string; slug: string };
  steps: WorkflowStep[];
}

interface Report {
  id: number;
  title: string;
  filename: string;
  period: string;
  projectId: number | null;
  createdAt: string;
  mimeType: string | null;
}

interface Document {
  id: number;
  name: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  projectId: number;
}

interface KanbanTask {
  id: number;
  projectId: number;
  title: string;
  column: string;
  order: number;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  description: string | null;
  amount: string;
  currency: string;
  status: string;
  paidAt: string | null;
  pdfFilename: string | null;
  projectId: number | null;
  createdAt: string;
}

// ─── Visual config lookup ──────────────────────────────────────────────────

interface VisualConfig {
  icon: string;
  accentColor: string;
  ringColor: string;
  iconBg: string;
  iconText: string;
}

const VISUAL_PRESETS: { keywords: string[]; config: VisualConfig }[] = [
  {
    keywords: ["m365", "microsoft-365", "microsoft365", "health", "health-check", "tenant"],
    config: { icon: "health_and_safety", accentColor: "#0c9488", ringColor: "#89f5e7", iconBg: "#89f5e7", iconText: "#005049" },
  },
  {
    keywords: ["security", "audit", "compliance", "zero-trust"],
    config: { icon: "security", accentColor: "#54647a", ringColor: "#d0e1fb", iconBg: "#d0e1fb", iconText: "#54647a" },
  },
  {
    keywords: ["migration", "cloud", "azure", "cloud-migration"],
    config: { icon: "cloud_sync", accentColor: "#0078D4", ringColor: "#dae2fd", iconBg: "#dae2fd", iconText: "#003a70" },
  },
  {
    keywords: ["sharepoint", "share-point", "intranet"],
    config: { icon: "hub", accentColor: "#b24a8c", ringColor: "#fad9f0", iconBg: "#fad9f0", iconText: "#6b0050" },
  },
  {
    keywords: ["copilot", "ai", "power-platform", "powerplatform", "automation"],
    config: { icon: "auto_awesome", accentColor: "#7b5ea7", ringColor: "#e8def8", iconBg: "#e8def8", iconText: "#4a3670" },
  },
  {
    keywords: ["governance", "policy", "framework"],
    config: { icon: "policy", accentColor: "#5c5f72", ringColor: "#e0e2f0", iconBg: "#e0e2f0", iconText: "#3c3f52" },
  },
];

const DEFAULT_VISUAL: VisualConfig = {
  icon: "work", accentColor: "#191c1e", ringColor: "#e6e8ea", iconBg: "#e6e8ea", iconText: "#45464d",
};

function getVisualConfig(service: { name: string; slug: string }): VisualConfig {
  const haystack = `${service.slug} ${service.name}`.toLowerCase();
  for (const preset of VISUAL_PRESETS) {
    if (preset.keywords.some(kw => haystack.includes(kw))) return preset.config;
  }
  return DEFAULT_VISUAL;
}

// ─── Workflow Step components ─────────────────────────────────────────────

function StepCompleted({ label, width }: { label: string; width: string }) {
  return (
    <div className="flex flex-col items-center gap-3 relative z-10" style={{ width }}>
      <div className="w-10 h-10 rounded-full bg-[#0c9488] text-white flex items-center justify-center shadow-md">
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check</span>
      </div>
      <span className="text-[10px] text-center uppercase tracking-tighter d2-step-completed font-semibold">{label}</span>
    </div>
  );
}

function StepActive({ num, label, accentColor, ringColor, width }: {
  num: number; label: string; accentColor: string; ringColor: string; width: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 relative z-10" style={{ width }}>
      <div
        className="w-10 h-10 rounded-full bg-white border-4 flex items-center justify-center shadow-lg"
        style={{ borderColor: accentColor, color: accentColor, boxShadow: `0 0 0 4px ${ringColor}` }}
      >
        <span className="font-bold text-[14px]">{num}</span>
      </div>
      <span className="text-[10px] text-center uppercase tracking-tighter d2-step-active">{label}</span>
    </div>
  );
}

function StepPending({ num, label, width }: { num: number; label: string; width: string }) {
  return (
    <div className="flex flex-col items-center gap-3 relative z-10" style={{ width }}>
      <div className="w-10 h-10 rounded-full bg-[#f2f4f6] border-2 border-[#c6c6cd] text-[#76777d] flex items-center justify-center">
        <span className="font-bold text-[14px]">{num}</span>
      </div>
      <span className="text-[10px] text-center uppercase tracking-tighter d2-step-pending font-semibold">{label}</span>
    </div>
  );
}

// ─── Workflow tracker ─────────────────────────────────────────────────────

function WorkflowTracker({ service, config }: { service: ClientService; config: VisualConfig }) {
  const steps = [...service.steps].sort((a, b) => a.order - b.order);
  const totalSteps = steps.length;
  const completedCount = steps.filter(s => s.status === "completed").length;
  const activeIdx = steps.findIndex(s => s.status === "in_progress" || s.status === "blocked");
  const progressPct = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;
  const stepWidth = totalSteps > 0 ? `${100 / totalSteps}%` : "100%";

  const activeStepLabel =
    activeIdx >= 0
      ? `Stage ${activeIdx + 1}: ${steps[activeIdx].title}`
      : completedCount === totalSteps && totalSteps > 0
        ? "All stages complete"
        : "Not yet started";

  const badgeLabel =
    service.status === "active" ? "Active Engagement"
    : service.status === "pending" ? "Queued"
    : service.status.charAt(0).toUpperCase() + service.status.slice(1);

  if (totalSteps === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-[#76777d]">
        <span className="material-symbols-outlined" style={{ fontSize: 40 }}>pending_actions</span>
        <p className="text-sm">Workflow steps are being prepared — check back soon.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded" style={{ backgroundColor: config.iconBg, color: config.iconText }}>
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>{config.icon}</span>
          </div>
          <div>
            <h3 className="text-2xl font-semibold text-[#191c1e]">{service.service.name}: Delivery Workflow</h3>
            <p className="text-[#45464d] text-sm">Currently at {activeStepLabel}</p>
          </div>
        </div>
        <span
          className="px-3 py-1 rounded-full text-[10px] uppercase font-semibold tracking-wider"
          style={service.status === "active" ? { backgroundColor: config.accentColor, color: "#fff" } : { backgroundColor: "#e6e8ea", color: "#45464d" }}
        >
          {badgeLabel}
        </span>
      </div>
      <div className="bg-white p-8 rounded-xl border border-[#c6c6cd] d2-card-elevation overflow-hidden">
        <div className="relative flex justify-between">
          <div className="absolute top-5 left-0 w-full h-[2px] bg-[#c6c6cd] -z-0" />
          <div
            className="absolute top-5 left-0 h-[2px] -z-0 transition-all duration-1000"
            style={{ width: `${progressPct}%`, backgroundColor: config.accentColor }}
          />
          {steps.map((step, i) => {
            const label = `${i + 1}. ${step.title}`;
            if (step.status === "completed") return <StepCompleted key={step.id} label={label} width={stepWidth} />;
            if (step.status === "in_progress" || step.status === "blocked") {
              return <StepActive key={step.id} num={i + 1} label={label} accentColor={config.accentColor} ringColor={config.ringColor} width={stepWidth} />;
            }
            return <StepPending key={step.id} num={i + 1} label={label} width={stepWidth} />;
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function fileIcon(mimeType: string | null): { icon: string; color: string } {
  if (!mimeType) return { icon: "description", color: "#76777d" };
  if (mimeType.includes("pdf")) return { icon: "picture_as_pdf", color: "#ba1a1a" };
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv")) return { icon: "table_chart", color: "#0c9488" };
  if (mimeType.includes("zip") || mimeType.includes("compressed")) return { icon: "folder_zip", color: "#0078D4" };
  if (mimeType.includes("word") || mimeType.includes("document")) return { icon: "article", color: "#0078D4" };
  if (mimeType.includes("image")) return { icon: "image", color: "#7b5ea7" };
  return { icon: "description", color: "#45464d" };
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

// ─── Main page ────────────────────────────────────────────────────────────

export default function Dashboard2() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [services, setServices] = useState<ClientService[] | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [docsByProject, setDocsByProject] = useState<Record<number, Document[]>>({});
  const [tasksByProject, setTasksByProject] = useState<Record<number, KanbanTask[]>>({});
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const { fetchWithAuth } = useAuth();

  const loadData = useCallback(async () => {
    try {
      const [svcRes, rptRes, invRes] = await Promise.all([
        fetchWithAuth("/api/portal/services"),
        fetchWithAuth("/api/portal/reports"),
        fetchWithAuth("/api/portal/invoices"),
      ]);
      const svcs: ClientService[] = svcRes.ok ? await svcRes.json() : [];
      const rpts: Report[] = rptRes.ok ? await rptRes.json() : [];
      const invs: Invoice[] = invRes.ok ? await invRes.json() : [];
      setServices(svcs);
      setReports(rpts);
      setInvoices(invs);

      // Fetch documents + tasks for every project the user has
      const projectIds = [...new Set(svcs.map(s => s.projectId).filter((id): id is number => id !== null))];
      if (projectIds.length > 0) {
        const results = await Promise.all(
          projectIds.map(pid =>
            fetchWithAuth(`/api/portal/projects/${pid}`)
              .then(r => (r.ok ? r.json() : { documents: [], tasks: [] }))
              .then((data: { documents?: Document[]; tasks?: KanbanTask[] }) => ({
                pid,
                docs: data.documents ?? [],
                tasks: data.tasks ?? [],
              }))
              .catch(() => ({ pid, docs: [] as Document[], tasks: [] as KanbanTask[] }))
          )
        );
        const docMap: Record<number, Document[]> = {};
        const taskMap: Record<number, KanbanTask[]> = {};
        for (const { pid, docs, tasks } of results) {
          docMap[pid] = docs;
          taskMap[pid] = tasks;
        }
        setDocsByProject(docMap);
        setTasksByProject(taskMap);
      }
    } catch {
      setServices([]);
    }
  }, [fetchWithAuth]);

  useEffect(() => { loadData(); }, [loadData]);

  const activeService = services?.[activeIdx] ?? null;
  const activeConfig = activeService ? getVisualConfig(activeService.service) : DEFAULT_VISUAL;

  const activeReports = activeService
    ? reports.filter(r => r.projectId == null || r.projectId === activeService.projectId)
    : [];

  const activeDocuments = activeService?.projectId != null
    ? (docsByProject[activeService.projectId] ?? [])
    : [];

  const activeTasks = activeService?.projectId != null
    ? (tasksByProject[activeService.projectId] ?? [])
    : [];

  const taskOpen = activeTasks.filter(t => t.column === "backlog" || t.column === "in_progress").length;
  const taskWaiting = activeTasks.filter(t => t.column === "waiting_on_customer").length;
  const taskClosed = activeTasks.filter(t => t.column === "completed").length;

  // ─── Billing stats ───────────────────────────────────────────────────────
  const totalBilled = invoices.reduce((sum, inv) => sum + parseFloat(inv.amount), 0);
  const totalPaid   = invoices.filter(inv => inv.status === "paid").reduce((sum, inv) => sum + parseFloat(inv.amount), 0);
  const totalOwed   = invoices.filter(inv => inv.status !== "paid").reduce((sum, inv) => sum + parseFloat(inv.amount), 0);

  function fmtCurrency(amount: number, currency = "usd") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: 0 }).format(amount);
  }

  function statusBadge(status: string) {
    switch (status) {
      case "paid":     return { label: "Paid",     bg: "bg-[#dcfce7]", text: "text-[#16a34a]" };
      case "overdue":  return { label: "Overdue",  bg: "bg-[#fee2e2]", text: "text-[#dc2626]" };
      default:         return { label: "Pending",  bg: "bg-[#fff3cd]", text: "text-[#b45309]" };
    }
  }

  return (
    <PortalLayout>
      <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-[1280px] mx-auto space-y-12">

        {/* Page Header */}
        <header className="flex items-center justify-between flex-wrap gap-4 pb-6 border-b border-[#c6c6cd]">
          <h2 className="text-3xl font-semibold text-[#191c1e] tracking-tight">Executive Dashboard</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-[#c6c6cd]">
              <span className="material-symbols-outlined text-[#0c9488]" style={{ fontSize: 20 }}>verified_user</span>
              <span className="text-sm font-semibold text-[#191c1e]">Secure Session Active</span>
            </div>
          </div>
        </header>

        {/* Multi-Service Workflow Tracker */}
        <section>
          {services === null ? (
            <div className="flex items-center gap-2 text-[#76777d] text-sm py-8">
              <span className="material-symbols-outlined animate-spin" style={{ fontSize: 20 }}>progress_activity</span>
              <span>Loading service data…</span>
            </div>
          ) : services.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-16 text-[#76777d]">
              <span className="material-symbols-outlined" style={{ fontSize: 48 }}>inbox</span>
              <p className="text-base font-medium">No active services yet.</p>
              <p className="text-sm">Once you purchase a service, your workflow tracker will appear here.</p>
            </div>
          ) : (
            <>
              {/* Dynamic service tabs */}
              <div className="flex items-center border-b border-[#c6c6cd] w-full mb-8 gap-2 flex-wrap">
                {services.map((svc, i) => {
                  const cfg = getVisualConfig(svc.service);
                  const isActive = i === activeIdx;
                  return (
                    <button
                      key={svc.id}
                      onClick={() => setActiveIdx(i)}
                      className={`d2-service-tab py-4 px-3 text-[11px] uppercase tracking-widest font-semibold flex items-center gap-2 transition-colors${isActive ? " active" : ""}`}
                      style={isActive ? { borderBottom: `2px solid ${cfg.accentColor}`, color: cfg.accentColor } : {}}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{cfg.icon}</span>
                      <span>{svc.service.name}</span>
                    </button>
                  );
                })}
              </div>

              {/* Workflow for selected service */}
              {activeService && (
                <>
                  <WorkflowTracker service={activeService} config={activeConfig} />

                  {/* Task summary stats */}
                  {activeTasks.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                      <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation px-6 py-5 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-[#dae2fd] flex items-center justify-center flex-shrink-0">
                          <span className="material-symbols-outlined text-[#0078D4]" style={{ fontSize: 20 }}>task_alt</span>
                        </div>
                        <div>
                          <p className="text-3xl font-bold text-[#191c1e] leading-none">{taskOpen}</p>
                          <p className="text-xs text-[#76777d] mt-1 font-medium uppercase tracking-wide">Open Tasks</p>
                        </div>
                      </div>
                      <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation px-6 py-5 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-[#fff3cd] flex items-center justify-center flex-shrink-0">
                          <span className="material-symbols-outlined text-[#b45309]" style={{ fontSize: 20 }}>hourglass_empty</span>
                        </div>
                        <div>
                          <p className="text-3xl font-bold text-[#191c1e] leading-none">{taskWaiting}</p>
                          <p className="text-xs text-[#76777d] mt-1 font-medium uppercase tracking-wide">Waiting on You</p>
                        </div>
                      </div>
                      <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation px-6 py-5 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-[#dcfce7] flex items-center justify-center flex-shrink-0">
                          <span className="material-symbols-outlined text-[#16a34a]" style={{ fontSize: 20 }}>check_circle</span>
                        </div>
                        <div>
                          <p className="text-3xl font-bold text-[#191c1e] leading-none">{taskClosed}</p>
                          <p className="text-xs text-[#76777d] mt-1 font-medium uppercase tracking-wide">Completed</p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>

        {/* Reports + Documents (only when a service is selected) */}
        {services !== null && services.length > 0 && activeService && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

            {/* Service Reports */}
            <section>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-semibold text-[#191c1e]">Service Reports</h3>
              </div>
              <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation p-6 min-h-[240px]">
                {activeReports.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-[#76777d]">
                    <span className="material-symbols-outlined" style={{ fontSize: 36 }}>folder_open</span>
                    <p className="text-sm">No reports yet for {activeService.service.name}.</p>
                    <p className="text-xs text-[#9e9fa6]">Reports will appear here once your consultant publishes them.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeReports.map(r => {
                      const { icon, color } = fileIcon(r.mimeType);
                      return (
                        <a
                          key={r.id}
                          href={`/api/portal/reports/${r.id}/download`}
                          className="flex items-center justify-between p-3 bg-[#f2f4f6] rounded border border-[#c6c6cd]/30 hover:bg-[#e6e8ea] cursor-pointer transition-colors group"
                          target="_blank"
                          rel="noreferrer"
                        >
                          <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined" style={{ fontSize: 20, color }}>{icon}</span>
                            <div>
                              <p className="text-sm font-medium text-[#191c1e] group-hover:text-[#0078D4] transition-colors">{r.title}</p>
                              <p className="text-[10px] text-[#76777d] capitalize">{r.period} report</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-[#76777d]">{formatDate(r.createdAt)}</span>
                            <span className="material-symbols-outlined text-[#76777d] group-hover:text-[#0078D4] transition-colors" style={{ fontSize: 18 }}>download</span>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* Secure Document Vault */}
            <section>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-semibold text-[#191c1e]">Secure Document Vault</h3>
                {activeService.projectId && (
                  <label className="bg-[#191c1e] text-white px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-2 cursor-pointer hover:bg-[#2d3033] transition-colors">
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>upload_file</span>
                    <span>Upload</span>
                    <UploadInput projectId={activeService.projectId} fetchWithAuth={fetchWithAuth} onUploaded={loadData} />
                  </label>
                )}
              </div>
              <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation p-6 min-h-[240px]">
                {activeDocuments.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-[#76777d]">
                    <span className="material-symbols-outlined" style={{ fontSize: 36 }}>lock</span>
                    <p className="text-sm">No documents yet for {activeService.service.name}.</p>
                    <p className="text-xs text-[#9e9fa6]">Upload files or wait for your consultant to share documents here.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeDocuments.map(doc => {
                      const { icon, color } = fileIcon(doc.mimeType);
                      return (
                        <a
                          key={doc.id}
                          href={`/api/portal/documents/${doc.id}/download`}
                          className="flex items-center justify-between p-3 bg-[#f2f4f6] rounded border border-[#c6c6cd]/30 hover:bg-[#e6e8ea] cursor-pointer transition-colors group"
                          target="_blank"
                          rel="noreferrer"
                        >
                          <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined" style={{ fontSize: 20, color }}>{icon}</span>
                            <div>
                              <p className="text-sm font-medium text-[#191c1e] group-hover:text-[#0078D4] transition-colors">{doc.name}</p>
                              {doc.sizeBytes && (
                                <p className="text-[10px] text-[#76777d]">{formatBytes(doc.sizeBytes)}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-[#76777d]">{formatDate(doc.createdAt)}</span>
                            <span className="material-symbols-outlined text-[#76777d] group-hover:text-[#0078D4] transition-colors" style={{ fontSize: 18 }}>download</span>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

          </div>
        )}

        {/* ── Billing & Invoices ── */}
        {invoices.length > 0 && (
          <section className="space-y-6">
            <h3 className="text-2xl font-semibold text-[#191c1e]">Billing &amp; Invoices</h3>

            {/* Stats row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation px-6 py-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#dae2fd] flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-[#0078D4]" style={{ fontSize: 20 }}>receipt_long</span>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[#191c1e] leading-none">{fmtCurrency(totalBilled)}</p>
                  <p className="text-xs text-[#76777d] mt-1 font-medium uppercase tracking-wide">Total Invoiced</p>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation px-6 py-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#dcfce7] flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-[#16a34a]" style={{ fontSize: 20 }}>payments</span>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[#191c1e] leading-none">{fmtCurrency(totalPaid)}</p>
                  <p className="text-xs text-[#76777d] mt-1 font-medium uppercase tracking-wide">Total Paid</p>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation px-6 py-5 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${totalOwed > 0 ? "bg-[#fee2e2]" : "bg-[#f2f4f6]"}`}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: totalOwed > 0 ? "#dc2626" : "#76777d" }}>pending_actions</span>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[#191c1e] leading-none">{fmtCurrency(totalOwed)}</p>
                  <p className="text-xs text-[#76777d] mt-1 font-medium uppercase tracking-wide">Outstanding</p>
                </div>
              </div>
            </div>

            {/* Invoice list */}
            <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="border-b border-[#e8e9eb] bg-[#f7f9fc]">
                    <th className="text-left text-[11px] font-semibold text-[#76777d] uppercase tracking-wider px-5 py-3">Invoice</th>
                    <th className="text-left text-[11px] font-semibold text-[#76777d] uppercase tracking-wider px-5 py-3">Description</th>
                    <th className="text-left text-[11px] font-semibold text-[#76777d] uppercase tracking-wider px-5 py-3">Date</th>
                    <th className="text-right text-[11px] font-semibold text-[#76777d] uppercase tracking-wider px-5 py-3">Amount</th>
                    <th className="text-center text-[11px] font-semibold text-[#76777d] uppercase tracking-wider px-5 py-3">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8e9eb]">
                  {invoices.map(inv => {
                    const badge = statusBadge(inv.status);
                    return (
                      <tr key={inv.id} className="hover:bg-[#f7f9fc] transition-colors">
                        <td className="px-5 py-4 font-mono text-[12px] text-[#76777d] whitespace-nowrap">{inv.invoiceNumber}</td>
                        <td className="px-5 py-4 text-[#191c1e] max-w-[260px] truncate">{inv.description ?? "—"}</td>
                        <td className="px-5 py-4 text-[#76777d] whitespace-nowrap text-[12px]">
                          {new Date(inv.paidAt ?? inv.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        <td className="px-5 py-4 text-right font-semibold text-[#191c1e] whitespace-nowrap">
                          {fmtCurrency(parseFloat(inv.amount), inv.currency)}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right whitespace-nowrap">
                          {inv.pdfFilename ? (
                            <a
                              href={`/api/portal/invoices/${inv.id}/download`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[#0078D4] hover:text-[#005a9e] text-[12px] font-medium transition-colors"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>download</span>
                              PDF
                            </a>
                          ) : inv.status !== "paid" ? (
                            <a
                              href={`/portal/billing`}
                              className="inline-flex items-center gap-1 text-[#b45309] hover:text-[#92400e] text-[12px] font-medium transition-colors"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>credit_card</span>
                              Pay Now
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

      </div>
    </PortalLayout>
  );
}

// ─── Hidden file upload input ─────────────────────────────────────────────

function UploadInput({
  projectId,
  fetchWithAuth,
  onUploaded,
}: {
  projectId: number;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
  onUploaded: () => void;
}) {
  const [uploading, setUploading] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name);
      const res = await fetchWithAuth(`/api/portal/projects/${projectId}/documents`, { method: "POST", body: form });
      if (res.ok) onUploaded();
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <input
      type="file"
      className="sr-only"
      disabled={uploading}
      onChange={handleChange}
    />
  );
}
