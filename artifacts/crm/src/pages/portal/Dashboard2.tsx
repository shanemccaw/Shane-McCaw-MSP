import { useState, useEffect, useCallback } from "react";
import PortalLayout from "@/components/PortalLayout";
import { useAuth } from "@/contexts/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceTab = "m365" | "security" | "migration";

type StepStatus = "pending" | "in_progress" | "completed" | "blocked";

interface WorkflowStep {
  id: number;
  title: string;
  status: StepStatus;
  order: number;
}

interface ClientService {
  id: number;
  status: string;
  service: { id: number; name: string; slug: string };
  steps: WorkflowStep[];
}

// ─── Step components ──────────────────────────────────────────────────────────

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

function StepActive({ num, label, accentColor, ringColor, width }: { num: number; label: string; accentColor: string; ringColor: string; width: string }) {
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

// ─── Tab configuration ────────────────────────────────────────────────────────

interface TabConfig {
  tab: ServiceTab;
  label: string;
  icon: string;
  accentColor: string;
  ringColor: string;
  iconBg: string;
  iconText: string;
  /** Keywords in service slug or name (lowercased) that map to this tab */
  keywords: string[];
  /** Fallback mock steps when no real service exists */
  mockSteps: { label: string; status: "completed" | "in_progress" | "pending" }[];
  mockTitle: string;
  mockSubtitle: string;
  mockBadge: string;
  mockBadgeClass: string;
}

const TAB_CONFIGS: TabConfig[] = [
  {
    tab: "m365",
    label: "M365 Health Check",
    icon: "health_and_safety",
    accentColor: "#0c9488",
    ringColor: "#89f5e7",
    iconBg: "#89f5e7",
    iconText: "#005049",
    keywords: ["m365", "microsoft-365", "microsoft365", "health", "health-check"],
    mockTitle: "M365 Health Check: Delivery Workflow",
    mockSubtitle: "Currently at Stage 5: Assessments",
    mockBadge: "Active Engagement",
    mockBadgeClass: "bg-[#0c9488] text-white",
    mockSteps: [
      { label: "1. Access", status: "completed" },
      { label: "2. Schedule", status: "completed" },
      { label: "3. Execute", status: "completed" },
      { label: "4. Review", status: "completed" },
      { label: "5. Assessments", status: "in_progress" },
      { label: "6. Report", status: "pending" },
      { label: "7. Debrief", status: "pending" },
      { label: "8. End", status: "pending" },
    ],
  },
  {
    tab: "security",
    label: "Security Audit",
    icon: "security",
    accentColor: "#54647a",
    ringColor: "#d0e1fb",
    iconBg: "#d0e1fb",
    iconText: "#54647a",
    keywords: ["security", "audit", "security-audit"],
    mockTitle: "Security Audit: Progress Tracker",
    mockSubtitle: "Currently at Stage 2: Scope Definition",
    mockBadge: "Queued",
    mockBadgeClass: "bg-[#e6e8ea] text-[#45464d]",
    mockSteps: [
      { label: "1. Intake", status: "completed" },
      { label: "2. Scope", status: "in_progress" },
      { label: "3. Scan", status: "pending" },
      { label: "4. Analyze", status: "pending" },
      { label: "5. Validate", status: "pending" },
      { label: "6. Findings", status: "pending" },
      { label: "7. Strategy", status: "pending" },
      { label: "8. Close", status: "pending" },
    ],
  },
  {
    tab: "migration",
    label: "Cloud Migration",
    icon: "cloud_sync",
    accentColor: "#191c1e",
    ringColor: "#dae2fd",
    iconBg: "#131b2e",
    iconText: "#7c839b",
    keywords: ["migration", "cloud", "azure", "cloud-migration"],
    mockTitle: "Azure Migration: Project Timeline",
    mockSubtitle: "Currently at Stage 1: Initial Discovery",
    mockBadge: "Planning",
    mockBadgeClass: "bg-[#e6e8ea] text-[#45464d]",
    mockSteps: [
      { label: "1. Discovery", status: "in_progress" },
      { label: "2. Assessment", status: "pending" },
      { label: "3. Pilot", status: "pending" },
      { label: "4. Planning", status: "pending" },
      { label: "5. Migration", status: "pending" },
      { label: "6. Testing", status: "pending" },
      { label: "7. Go-Live", status: "pending" },
      { label: "8. Support", status: "pending" },
    ],
  },
];

// ─── Dynamic tracker (real API data) ─────────────────────────────────────────

function DynamicTracker({ service, config }: { service: ClientService; config: TabConfig }) {
  const steps = [...service.steps].sort((a, b) => a.order - b.order);
  const totalSteps = steps.length;
  const completedCount = steps.filter(s => s.status === "completed").length;
  const activeIdx = steps.findIndex(s => s.status === "in_progress" || s.status === "blocked");
  const progressPct = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;
  const stepWidth = totalSteps > 0 ? `${100 / totalSteps}%` : "12.5%";

  const activeStepLabel =
    activeIdx >= 0
      ? `Stage ${activeIdx + 1}: ${steps[activeIdx].title}`
      : completedCount === totalSteps && totalSteps > 0
        ? "All stages complete"
        : "Not yet started";

  const badgeLabel =
    service.status === "active"
      ? "Active Engagement"
      : service.status === "pending"
        ? "Queued"
        : service.status.charAt(0).toUpperCase() + service.status.slice(1);

  const badgeClass =
    service.status === "active"
      ? "text-white"
      : "bg-[#e6e8ea] text-[#45464d]";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded" style={{ backgroundColor: config.iconBg, color: config.iconText }}>
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>{config.icon}</span>
          </div>
          <div>
            <h3 className="text-2xl font-semibold text-[#191c1e]">{service.service.name}</h3>
            <p className="text-[#45464d] text-sm">Currently at {activeStepLabel}</p>
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-[10px] uppercase font-semibold tracking-wider ${badgeClass}`}
          style={service.status === "active" ? { backgroundColor: config.accentColor } : {}}
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
            if (step.status === "completed") {
              return <StepCompleted key={step.id} label={label} width={stepWidth} />;
            }
            if (step.status === "in_progress" || step.status === "blocked") {
              return (
                <StepActive
                  key={step.id}
                  num={i + 1}
                  label={label}
                  accentColor={config.accentColor}
                  ringColor={config.ringColor}
                  width={stepWidth}
                />
              );
            }
            return <StepPending key={step.id} num={i + 1} label={label} width={stepWidth} />;
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Mock tracker (fallback) ──────────────────────────────────────────────────

function MockTracker({ config }: { config: TabConfig }) {
  const steps = config.mockSteps;
  const totalSteps = steps.length;
  const completedCount = steps.filter(s => s.status === "completed").length;
  const progressPct = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;
  const stepWidth = `${100 / totalSteps}%`;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded" style={{ backgroundColor: config.iconBg, color: config.iconText }}>
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>{config.icon}</span>
          </div>
          <div>
            <h3 className="text-2xl font-semibold text-[#191c1e]">{config.mockTitle}</h3>
            <p className="text-[#45464d] text-sm">{config.mockSubtitle}</p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-[10px] uppercase font-semibold tracking-wider ${config.mockBadgeClass}`}>
          {config.mockBadge}
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
            if (step.status === "completed") {
              return <StepCompleted key={i} label={step.label} width={stepWidth} />;
            }
            if (step.status === "in_progress") {
              return (
                <StepActive
                  key={i}
                  num={i + 1}
                  label={step.label}
                  accentColor={config.accentColor}
                  ringColor={config.ringColor}
                  width={stepWidth}
                />
              );
            }
            return <StepPending key={i} num={i + 1} label={step.label} width={stepWidth} />;
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Helper: match a service to a tab config ──────────────────────────────────

function matchService(services: ClientService[], config: TabConfig): ClientService | undefined {
  const matches = services.filter(s => {
    const haystack = `${s.service.slug} ${s.service.name}`.toLowerCase();
    return config.keywords.some(kw => haystack.includes(kw));
  });
  if (matches.length === 0) return undefined;
  return matches.find(s => s.status === "active") ?? matches[0];
}

/** Return the first tab that has a matching active service, else the first matched tab, else "m365". */
function deriveInitialTab(services: ClientService[]): ServiceTab {
  for (const cfg of TAB_CONFIGS) {
    const match = matchService(services, cfg);
    if (match && match.status === "active") return cfg.tab;
  }
  for (const cfg of TAB_CONFIGS) {
    if (matchService(services, cfg)) return cfg.tab;
  }
  return "m365";
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Dashboard2() {
  const [activeTab, setActiveTab] = useState<ServiceTab>("m365");
  const [services, setServices] = useState<ClientService[] | null>(null);
  const { fetchWithAuth } = useAuth();

  const loadServices = useCallback(() => {
    fetchWithAuth("/api/portal/services")
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((data: ClientService[]) => {
        setServices(data);
        setActiveTab(deriveInitialTab(data));
      })
      .catch(() => setServices([]));
  }, [fetchWithAuth]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  const activeConfig = TAB_CONFIGS.find(c => c.tab === activeTab)!;
  const activeService = services ? matchService(services, activeConfig) : undefined;

  return (
    <PortalLayout>
      <div className="p-10 max-w-[1280px] mx-auto space-y-12">

        {/* Page Header */}
        <header className="flex items-center justify-between pb-6 border-b border-[#c6c6cd]">
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
          <div className="flex items-center border-b border-[#c6c6cd] w-full mb-4 gap-6">
            {TAB_CONFIGS.map(cfg => (
              <button
                key={cfg.tab}
                onClick={() => setActiveTab(cfg.tab)}
                className={`d2-service-tab py-4 px-2 text-[11px] uppercase tracking-widest font-semibold flex items-center gap-2${activeTab === cfg.tab ? " active" : ""}`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{cfg.icon}</span>
                <span>{cfg.label}</span>
              </button>
            ))}
          </div>

          {services === null ? (
            <div className="flex items-center gap-2 text-[#76777d] text-sm py-8">
              <span className="material-symbols-outlined animate-spin" style={{ fontSize: 20 }}>progress_activity</span>
              <span>Loading service data…</span>
            </div>
          ) : activeService ? (
            <DynamicTracker service={activeService} config={activeConfig} />
          ) : (
            <MockTracker config={activeConfig} />
          )}
        </section>

        {/* Messaging Hub + Calendar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Messaging Hub */}
          <section className="lg:col-span-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-semibold text-[#191c1e]">Secure Messaging Hub</h3>
              <button className="text-[#0c9488] text-sm font-semibold flex items-center gap-1 hover:underline">
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit_square</span>
                <span>New Message</span>
              </button>
            </div>
            <div className="bg-white rounded-xl border border-[#c6c6cd] overflow-hidden flex h-[450px] d2-card-elevation">
              {/* Thread list */}
              <div className="w-72 border-r border-[#c6c6cd] bg-[#f2f4f6] flex flex-col flex-shrink-0">
                <div className="p-4 border-b border-[#c6c6cd] bg-white">
                  <div className="relative">
                    <input
                      className="w-full pl-9 pr-4 py-2 bg-[#eceef0] rounded-lg border-none text-sm focus:ring-1 focus:ring-[#0078D4] outline-none"
                      placeholder="Search mail..."
                      type="text"
                      readOnly
                    />
                    <span className="material-symbols-outlined absolute left-2 top-2 text-[#45464d]" style={{ fontSize: 20 }}>search</span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto d2-custom-scrollbar">
                  <div className="p-3 bg-[#d0e1fb]/30 border-l-4 border-[#0078D4]">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-bold text-[13px]">Shane McCaw</span>
                      <span className="text-[10px] text-[#76777d]">10:42 AM</span>
                    </div>
                    <p className="text-[12px] font-semibold text-[#191c1e] truncate">Update: Tenant Config Review</p>
                    <p className="text-[11px] text-[#45464d] line-clamp-1">I've reviewed the exports you sent yesterday...</p>
                  </div>
                  <div className="p-3 border-b border-[#c6c6cd]/30 hover:bg-[#e6e8ea] cursor-pointer">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium text-[13px]">Support Team</span>
                      <span className="text-[10px] text-[#76777d]">Yesterday</span>
                    </div>
                    <p className="text-[12px] text-[#191c1e] truncate">Onboarding Completed</p>
                    <p className="text-[11px] text-[#45464d] line-clamp-1">Your secure vault is now ready for use...</p>
                  </div>
                  <div className="p-3 border-b border-[#c6c6cd]/30 hover:bg-[#e6e8ea] cursor-pointer">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium text-[13px]">Billing Dept</span>
                      <span className="text-[10px] text-[#76777d]">Oct 18</span>
                    </div>
                    <p className="text-[12px] text-[#191c1e] truncate">Invoice #INV-2023-089</p>
                    <p className="text-[11px] text-[#45464d] line-clamp-1">Please find the attached invoice for the M365...</p>
                  </div>
                </div>
              </div>
              {/* Message pane */}
              <div className="flex-1 flex flex-col bg-white">
                <div className="p-4 border-b border-[#c6c6cd] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#191c1e] rounded-full flex items-center justify-center text-white font-bold text-[12px]">SM</div>
                    <div>
                      <h4 className="font-bold text-sm">Shane McCaw</h4>
                      <p className="text-[10px] text-[#0c9488]">Online · Lead Consultant</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[#45464d]">
                    <span className="material-symbols-outlined cursor-pointer hover:text-[#0078D4]" style={{ fontSize: 20 }}>archive</span>
                    <span className="material-symbols-outlined cursor-pointer hover:text-[#0078D4]" style={{ fontSize: 20 }}>report</span>
                    <span className="material-symbols-outlined cursor-pointer hover:text-[#ba1a1a] text-[#ba1a1a]" style={{ fontSize: 20 }}>delete</span>
                  </div>
                </div>
                <div className="flex-1 p-6 overflow-y-auto d2-custom-scrollbar space-y-4">
                  <div className="flex flex-col items-end gap-1">
                    <div className="bg-[#d0e1fb] text-[#0b1c30] p-3 rounded-2xl rounded-tr-none max-w-[80%] text-[13px]">
                      Hello Shane, I've uploaded the global configuration exports to the vault as requested. Could you confirm receipt?
                    </div>
                    <span className="text-[10px] text-[#76777d]">Sent 9:15 AM</span>
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <div className="bg-[#e6e8ea] text-[#191c1e] p-3 rounded-2xl rounded-tl-none max-w-[80%] text-[13px]">
                      Confirmed! I'm seeing 4 files in the secure vault. I'll begin the review process now and should have the initial assessment findings for the Stage 5 review by tomorrow.
                    </div>
                    <span className="text-[10px] text-[#76777d]">Shane McCaw · 10:42 AM</span>
                  </div>
                </div>
                <div className="p-4 border-t border-[#c6c6cd]">
                  <div className="flex items-center gap-2 bg-[#eceef0] p-2 rounded-xl">
                    <button className="text-[#45464d] p-1 hover:text-[#0078D4]">
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>attach_file</span>
                    </button>
                    <input className="flex-1 bg-transparent border-none focus:ring-0 text-sm outline-none" placeholder="Type a message..." type="text" readOnly />
                    <button className="bg-[#191c1e] text-white p-2 rounded-lg">
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>send</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Service Calendar */}
          <section className="lg:col-span-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-semibold text-[#191c1e]">Service Calendar</h3>
            </div>
            <div className="bg-white p-6 rounded-xl border border-[#c6c6cd] d2-card-elevation h-[450px] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <span className="font-bold text-base">October 2023</span>
                <div className="flex gap-1">
                  <button className="p-1 hover:bg-[#eceef0] rounded"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span></button>
                  <button className="p-1 hover:bg-[#eceef0] rounded"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span></button>
                </div>
              </div>
              <div className="grid grid-cols-7 text-center mb-2">
                {["S","M","T","W","T","F","S"].map((d, i) => (
                  <span key={i} className="text-[10px] text-[#76777d] font-bold">{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {[24,25,26,27,28,29,30].map(d => (
                  <div key={`prev-${d}`} className="h-8 flex items-center justify-center text-[11px] text-[#76777d]">{d}</div>
                ))}
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                  <div key={d} className={`h-8 flex items-center justify-center text-[11px] font-bold rounded-full ${d === 12 ? "bg-[#191c1e] text-white" : d === 24 ? "bg-[#89f5e7] text-[#005049]" : "text-[#191c1e]"}`}>
                    {d}
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-[#c6c6cd] space-y-3 overflow-y-auto d2-custom-scrollbar flex-1">
                <div className="flex items-start gap-3">
                  <div className="w-1 bg-[#0c9488] h-10 rounded flex-shrink-0"></div>
                  <div>
                    <p className="text-[11px] font-bold">Oct 24 · Milestone</p>
                    <p className="text-[12px] text-[#45464d]">M365 Configuration Report Delivery</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-1 bg-[#505f76] h-10 rounded flex-shrink-0"></div>
                  <div>
                    <p className="text-[11px] font-bold">Oct 26 · Meeting</p>
                    <p className="text-[12px] text-[#45464d]">Post-Audit Review Call (30 min)</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Service Reports + Document Vault */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Service Reports */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-semibold text-[#191c1e]">Service Reports</h3>
            </div>
            <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation p-6 space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-[#191c1e]" style={{ fontSize: 20 }}>folder_open</span>
                  <h4 className="font-bold text-sm text-[#191c1e]">M365 Health Check Reports</h4>
                </div>
                <div className="space-y-2 ml-7">
                  {[
                    { name: "Initial Discovery Findings - Final", date: "Oct 12, 2023" },
                    { name: "Security Posture Audit Draft", date: "In Progress" },
                  ].map((r) => (
                    <div key={r.name} className="flex items-center justify-between p-3 bg-[#f2f4f6] rounded border border-[#c6c6cd]/30 hover:bg-[#e6e8ea] cursor-pointer transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-[#ba1a1a]" style={{ fontSize: 20 }}>picture_as_pdf</span>
                        <span className="text-sm">{r.name}</span>
                      </div>
                      <span className="text-[10px] text-[#76777d]">{r.date}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-[#191c1e]" style={{ fontSize: 20 }}>folder_open</span>
                  <h4 className="font-bold text-sm text-[#191c1e]">Monthly Infrastructure Audits</h4>
                </div>
                <div className="space-y-2 ml-7">
                  <div className="flex items-center justify-between p-3 bg-[#f2f4f6] rounded border border-[#c6c6cd]/30 hover:bg-[#e6e8ea] cursor-pointer transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-[#0c9488]" style={{ fontSize: 20 }}>table_chart</span>
                      <span className="text-sm">Resource Utilization Summary - Sept</span>
                    </div>
                    <span className="text-[10px] text-[#76777d]">Oct 05, 2023</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Secure Document Vault */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-semibold text-[#191c1e]">Secure Document Vault</h3>
              <button className="bg-[#191c1e] text-white px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>upload_file</span>
                <span>Upload to Vault</span>
              </button>
            </div>
            <div className="bg-white rounded-xl border border-[#c6c6cd] d2-card-elevation p-6 space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-[#191c1e]" style={{ fontSize: 20 }}>gavel</span>
                  <h4 className="font-bold text-sm text-[#191c1e]">Legal &amp; Master Agreements</h4>
                </div>
                <div className="ml-7 rounded border border-[#c6c6cd]/30 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <tbody>
                      <tr className="hover:bg-[#eceef0]/30 transition-colors bg-[#f2f4f6]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined text-[#0c9488]" style={{ fontSize: 20 }}>verified</span>
                            <div>
                              <p className="text-sm font-semibold">Master Services Agreement (MSA)</p>
                              <p className="text-[10px] text-[#76777d]">Last accessed: 2 days ago</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center w-24">
                          <span className="px-2 py-0.5 bg-[#eceef0] text-[#45464d] rounded text-[10px] font-bold">CONTRACT</span>
                        </td>
                        <td className="px-4 py-3 text-right w-24">
                          <button className="text-[#0c9488] text-[11px] font-semibold hover:underline">View</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-[#191c1e]" style={{ fontSize: 20 }}>upload_file</span>
                  <h4 className="font-bold text-sm text-[#191c1e]">Project Uploads</h4>
                </div>
                <div className="ml-7 space-y-2">
                  {[
                    { name: "Tenant-Export-GlobalConfig.zip", size: "14.2 MB", icon: "folder_zip", color: "#0078D4" },
                    { name: "License-Inventory-Oct.xlsx", size: "1.1 MB", icon: "table_chart", color: "#0c9488" },
                  ].map(f => (
                    <div key={f.name} className="flex items-center justify-between p-3 bg-[#f2f4f6] rounded border border-[#c6c6cd]/30 hover:bg-[#e6e8ea] cursor-pointer transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined" style={{ fontSize: 20, color: f.color }}>{f.icon}</span>
                        <span className="text-sm">{f.name}</span>
                      </div>
                      <span className="text-[10px] text-[#76777d]">{f.size}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>

      </div>
    </PortalLayout>
  );
}
