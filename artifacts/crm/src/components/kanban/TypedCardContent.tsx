export type TaskType =
  | "training"
  | "environmentHealthCheck"
  | "governanceSetup"
  | "automationBuild"
  | "documentDelivery"
  | "discovery";

export interface TrainingMetadata {
  modules?: Array<{ name: string; completed?: boolean; durationMins?: number }>;
  estimatedHours?: number;
  prerequisites?: string;
  materialsUrl?: string;
}

export interface HealthCheckMetadata {
  healthStatus?: "healthy" | "warning" | "critical";
  scriptName?: string;
  lastRunDate?: string;
  outputSummary?: string;
}

export interface GovernanceMetadata {
  postureSummary?: string;
  configuredItems?: string[];
  sensitivityLabels?: string[];
  dlpPolicies?: string[];
  conditionalAccess?: string[];
}

export interface AutomationMetadata {
  flows?: Array<{
    name: string;
    status: "building" | "testing" | "live" | "error";
    trigger?: string;
    lastRun?: string;
  }>;
}

export interface DocumentMetadata {
  documents?: Array<{
    name: string;
    version?: string;
    approvalStatus: "pending" | "approved" | "revision_requested";
    downloadUrl?: string;
  }>;
}

export interface DiscoveryMetadata {
  riskScore?: "low" | "medium" | "high" | "critical";
  findingsSummary?: string;
  recommendations?: string[];
  assessmentUrl?: string;
}

export const TASK_TYPE_CONFIG: Record<
  TaskType,
  { label: string; badge: string; bar: string; icon: string }
> = {
  training: {
    label: "Training",
    badge: "bg-purple-100 text-purple-700 border border-purple-200",
    bar: "bg-purple-500",
    icon: "school",
  },
  environmentHealthCheck: {
    label: "Health Check",
    badge: "bg-green-100 text-green-700 border border-green-200",
    bar: "bg-green-500",
    icon: "monitor_heart",
  },
  governanceSetup: {
    label: "Governance",
    badge: "bg-blue-100 text-blue-700 border border-blue-200",
    bar: "bg-blue-500",
    icon: "shield",
  },
  automationBuild: {
    label: "Automation",
    badge: "bg-orange-100 text-orange-700 border border-orange-200",
    bar: "bg-orange-500",
    icon: "bolt",
  },
  documentDelivery: {
    label: "Document",
    badge: "bg-amber-100 text-amber-700 border border-amber-200",
    bar: "bg-amber-500",
    icon: "description",
  },
  discovery: {
    label: "Discovery",
    badge: "bg-pink-100 text-pink-700 border border-pink-200",
    bar: "bg-pink-500",
    icon: "microwave",
  },
};

const RISK_CFG = {
  low: { cls: "bg-green-100 text-green-700", label: "Low risk" },
  medium: { cls: "bg-yellow-100 text-yellow-700", label: "Medium risk" },
  high: { cls: "bg-orange-100 text-orange-700", label: "High risk" },
  critical: { cls: "bg-red-100 text-red-700", label: "Critical risk" },
};

const HEALTH_CFG = {
  healthy: {
    banner: "bg-green-50 border border-green-200 text-green-800",
    icon: "check_circle",
    label: "All systems healthy",
  },
  warning: {
    banner: "bg-yellow-50 border border-yellow-200 text-yellow-800",
    icon: "warning",
    label: "Needs attention",
  },
  critical: {
    banner: "bg-red-50 border border-red-200 text-red-800",
    icon: "error",
    label: "Requires immediate action",
  },
};

const FLOW_DOT: Record<string, string> = {
  live: "bg-green-500",
  testing: "bg-yellow-400",
  building: "bg-yellow-400",
  error: "bg-red-500",
};

const FLOW_STATUS_LABEL: Record<string, string> = {
  live: "Active",
  testing: "In testing",
  building: "In testing",
  error: "Needs attention",
};

const APPROVAL_LABEL: Record<string, string> = {
  approved: "Approved",
  pending: "Awaiting approval",
  revision_requested: "Revision requested",
};

const APPROVAL_CLS: Record<string, string> = {
  approved: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  revision_requested: "bg-red-100 text-red-700",
};

function TrainingBody({ m }: { m: TrainingMetadata }) {
  const modules = m.modules ?? [];
  const done = modules.filter(mod => mod.completed).length;
  const remaining = modules.filter(mod => !mod.completed);
  return (
    <div className="space-y-2">
      {modules.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-semibold text-[#0A2540]">
              {done}/{modules.length} modules complete
            </p>
            {m.estimatedHours && remaining.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                ~{Math.round(m.estimatedHours * (remaining.length / modules.length))}h left
              </p>
            )}
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="h-2 rounded-full bg-purple-500 transition-all"
              style={{ width: `${modules.length ? (done / modules.length) * 100 : 0}%` }}
            />
          </div>
          {remaining.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Next up: <span className="font-medium text-[#0A2540]">{remaining[0].name}</span>
            </p>
          )}
        </div>
      )}
      {m.prerequisites && (
        <p className="text-[10px] text-muted-foreground">
          Requires: {m.prerequisites}
        </p>
      )}
    </div>
  );
}

function HealthCheckBody({ m }: { m: HealthCheckMetadata }) {
  const cfg = m.healthStatus ? HEALTH_CFG[m.healthStatus] : null;
  return (
    <div className="space-y-2">
      {cfg && (
        <div className={`flex items-center gap-1.5 w-full rounded px-2 py-1.5 ${cfg.banner}`}>
          <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>{cfg.icon}</span>
          <span className="text-[10px] font-semibold">{cfg.label}</span>
        </div>
      )}
      {m.lastRunDate && (
        <p className="text-[10px] text-muted-foreground">
          Last checked:{" "}
          <span className="font-medium text-[#0A2540]">
            {new Date(m.lastRunDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </p>
      )}
      {m.outputSummary && (
        <p className="text-[10px] text-[#0A2540] leading-snug italic">{m.outputSummary}</p>
      )}
    </div>
  );
}

function GovernanceBody({ m }: { m: GovernanceMetadata }) {
  const allItems = [
    ...(m.sensitivityLabels ?? []),
    ...(m.dlpPolicies ?? []),
    ...(m.conditionalAccess ?? []),
    ...(m.configuredItems ?? []),
  ];
  return (
    <div className="space-y-2">
      {m.postureSummary && (
        <p className="text-[10px] text-[#0A2540] leading-snug">{m.postureSummary}</p>
      )}
      {allItems.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[#0A2540] mb-1">What's been configured:</p>
          <div className="space-y-0.5">
            {allItems.map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-blue-600 flex-shrink-0" style={{ fontSize: "13px" }}>check_circle</span>
                <span className="text-[10px] text-[#0A2540]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AutomationBody({ m }: { m: AutomationMetadata }) {
  const flows = m.flows ?? [];
  return (
    <div className="space-y-2">
      {flows.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[#0A2540] mb-1">Your automations:</p>
          <div className="space-y-1">
            {flows.map((flow, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${FLOW_DOT[flow.status] ?? "bg-gray-400"}`} />
                <span className="text-[10px] text-[#0A2540] truncate">{flow.name}</span>
                <span className="text-[9px] text-muted-foreground ml-auto flex-shrink-0">
                  {FLOW_STATUS_LABEL[flow.status] ?? flow.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentBody({ m, onMarkApproved }: { m: DocumentMetadata; onMarkApproved?: (docName: string) => void }) {
  const docs = m.documents ?? [];
  return (
    <div className="space-y-2">
      {docs.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[#0A2540] mb-1">Documents:</p>
          <div className="space-y-1.5">
            {docs.map((doc, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-medium text-[#0A2540] truncate">{doc.name}</p>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${APPROVAL_CLS[doc.approvalStatus]}`}>
                    {APPROVAL_LABEL[doc.approvalStatus]}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {doc.downloadUrl && (
                    <a
                      href={doc.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-[10px] font-semibold text-[#0078D4] hover:underline"
                    >
                      ↓ Download
                    </a>
                  )}
                  {doc.approvalStatus === "pending" && (
                    <button
                      onClick={e => { e.stopPropagation(); onMarkApproved?.(doc.name); }}
                      className="text-[9px] font-semibold text-teal-700 border border-teal-400 px-1.5 py-0.5 rounded hover:bg-teal-50 transition-colors"
                    >
                      Approve
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GenericBody({ m }: { m: Record<string, unknown> }) {
  const deliverables = (m.clientDeliverables as string[] | undefined) ?? [];
  const checklist = (m.checklist as Array<{ id: string; label: string }> | undefined) ?? [];
  const checklistState = (m.checklistState as Record<string, boolean> | undefined) ?? {};
  const done = checklist.filter(item => checklistState[item.id]).length;

  if (deliverables.length === 0 && checklist.length === 0) return null;

  return (
    <div className="space-y-2">
      {checklist.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-semibold text-[#0A2540]">{done}/{checklist.length} steps complete</p>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full bg-[#0078D4] transition-all"
              style={{ width: `${checklist.length ? (done / checklist.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
      {deliverables.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[#0A2540] mb-0.5">You&apos;ll receive:</p>
          <div className="space-y-0.5">
            {deliverables.slice(0, 3).map((d, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4]/50 flex-shrink-0" />
                <span className="text-[10px] text-muted-foreground">{d}</span>
              </div>
            ))}
            {deliverables.length > 3 && (
              <p className="text-[10px] text-muted-foreground pl-3">+{deliverables.length - 3} more</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DiscoveryBody({ m }: { m: DiscoveryMetadata }) {
  const recs = m.recommendations ?? [];
  const riskCfg = m.riskScore ? RISK_CFG[m.riskScore] : null;
  return (
    <div className="space-y-2">
      {riskCfg && (
        <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${riskCfg.cls}`}>
          {riskCfg.label}
        </span>
      )}
      {(m.findingsSummary || recs.length > 0) && (
        <div className="bg-gray-50 border border-l-4 border-gray-200 border-l-pink-400 rounded px-2 py-1.5 space-y-1.5">
          {m.findingsSummary && (
            <p className="text-[10px] text-[#0A2540] leading-snug">{m.findingsSummary}</p>
          )}
          {recs.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[#0A2540] mb-1">Recommended next steps:</p>
              <div className="space-y-0.5">
                {recs.map((r, i) => (
                  <div key={i} className="flex items-start gap-1">
                    <span className="material-symbols-outlined text-pink-500 flex-shrink-0" style={{ fontSize: "13px", marginTop: "1px" }}>arrow_right_alt</span>
                    <span className="text-[10px] text-[#0A2540]">{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {m.assessmentUrl && (
        <a
          href={m.assessmentUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[10px] text-[#0078D4] font-semibold hover:underline"
        >
          📋 Full assessment report
        </a>
      )}
    </div>
  );
}

export function TypedCardContent({
  taskType,
  metadata,
  onMarkDocumentApproved,
}: {
  taskType: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
  onMarkDocumentApproved?: (docName: string) => void;
}) {
  if (!taskType) return null;
  const cfg = TASK_TYPE_CONFIG[taskType as TaskType];
  if (!cfg) return null;

  const hasDetail = metadata && Object.keys(metadata).length > 0;

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded ${cfg.badge}`}>
          <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>{cfg.icon}</span>
          {cfg.label}
        </span>
      </div>

      {hasDetail && (
        <div>
          {taskType === "training" && (metadata as TrainingMetadata).modules?.length
            ? <TrainingBody m={metadata as TrainingMetadata} />
            : taskType === "training" && <GenericBody m={metadata} />}
          {taskType === "environmentHealthCheck" && (metadata as HealthCheckMetadata).healthStatus
            ? <HealthCheckBody m={metadata as HealthCheckMetadata} />
            : taskType === "environmentHealthCheck" && <GenericBody m={metadata} />}
          {taskType === "governanceSetup" && ((metadata as GovernanceMetadata).postureSummary || (metadata as GovernanceMetadata).configuredItems?.length)
            ? <GovernanceBody m={metadata as GovernanceMetadata} />
            : taskType === "governanceSetup" && <GenericBody m={metadata} />}
          {taskType === "automationBuild" && (metadata as AutomationMetadata).flows?.length
            ? <AutomationBody m={metadata as AutomationMetadata} />
            : taskType === "automationBuild" && <GenericBody m={metadata} />}
          {taskType === "documentDelivery" && (metadata as DocumentMetadata).documents?.length
            ? <DocumentBody m={metadata as DocumentMetadata} onMarkApproved={onMarkDocumentApproved} />
            : taskType === "documentDelivery" && <GenericBody m={metadata} />}
          {taskType === "discovery" && ((metadata as DiscoveryMetadata).riskScore || (metadata as DiscoveryMetadata).findingsSummary)
            ? <DiscoveryBody m={metadata as DiscoveryMetadata} />
            : taskType === "discovery" && <GenericBody m={metadata} />}
        </div>
      )}
    </div>
  );
}

// ─── Modal-level helpers & components ────────────────────────────────────────

export interface StatusBanner {
  variant: "error" | "warning" | "success";
  headline: string;
  detail?: string;
}

export function getTypedStatusBanner(
  taskType: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): StatusBanner | null {
  if (!taskType || !metadata) return null;
  const m = metadata;

  if (taskType === "environmentHealthCheck") {
    const s = m.healthStatus as string | undefined;
    if (s === "critical") return { variant: "error",   headline: "Requires immediate action", detail: m.outputSummary as string | undefined };
    if (s === "warning")  return { variant: "warning",  headline: "Needs attention",          detail: m.outputSummary as string | undefined };
    if (s === "healthy")  return { variant: "success",  headline: "All systems healthy" };
  }

  if (taskType === "automationBuild") {
    const flows = (m.flows as Array<{ status: string }> | undefined) ?? [];
    const n = flows.filter(f => f.status === "error").length;
    if (n > 0) return { variant: "error", headline: `${n} automation${n > 1 ? "s" : ""} need${n === 1 ? "s" : ""} attention` };
  }

  if (taskType === "documentDelivery") {
    const docs = (m.documents as Array<{ approvalStatus: string }> | undefined) ?? [];
    const rev = docs.filter(d => d.approvalStatus === "revision_requested").length;
    if (rev > 0) return { variant: "warning", headline: rev === 1 ? "A document needs revision" : `${rev} documents need revision` };
    if (docs.length > 0 && docs.every(d => d.approvalStatus === "approved"))
      return { variant: "success", headline: "All documents approved" };
  }

  if (taskType === "discovery") {
    const r = m.riskScore as string | undefined;
    if (r === "critical") return { variant: "error",  headline: "Critical risk identified — immediate attention required" };
    if (r === "high")     return { variant: "warning", headline: "High risk identified — review findings carefully" };
  }

  return null;
}

// ── Per-type modal body components (client view) ───────────────────────────────

function ModalClientBtn({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button onClick={e => { e.stopPropagation(); onClick?.(); }}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0A2540] border border-border bg-white hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors">
      {label}
    </button>
  );
}

function GenericModalBody({ m }: { m: Record<string, unknown> }) {
  const deliverables = (m.clientDeliverables as string[] | undefined) ?? [];
  const checklist = (m.checklist as Array<{ id: string; label: string }> | undefined) ?? [];
  const checklistState = (m.checklistState as Record<string, boolean> | undefined) ?? {};
  const done = checklist.filter(it => checklistState[it.id]).length;
  if (deliverables.length === 0 && checklist.length === 0) return null;
  return (
    <div className="space-y-4">
      {checklist.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-semibold text-[#0A2540]">{done}/{checklist.length} steps complete</span>
            <span className="text-xs text-muted-foreground">{Math.round((done / checklist.length) * 100)}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5">
            <div className="h-2.5 rounded-full bg-[#0078D4] transition-all" style={{ width: `${(done / checklist.length) * 100}%` }} />
          </div>
        </div>
      )}
      {deliverables.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">What you&apos;ll receive</p>
          <div className="space-y-1.5">
            {deliverables.map((d, i) => (
              <div key={i} className="flex items-center gap-2.5 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-[#0078D4] flex-shrink-0" />
                <span className="text-sm text-[#0A2540]">{d}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrainingModalBody({ m }: { m: Record<string, unknown> }) {
  const tm = m as TrainingMetadata;
  const modules = tm.modules ?? [];
  if (modules.length === 0) return <GenericModalBody m={m} />;
  const done = modules.filter(mod => mod.completed).length;
  const remaining = modules.filter(mod => !mod.completed);
  const remainingMins = remaining.reduce((s, mod) => s + (mod.durationMins ?? 0), 0);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-semibold text-[#0A2540]">{done}/{modules.length} modules complete</span>
          {remainingMins > 0 && <span className="text-xs text-muted-foreground">~{remainingMins >= 60 ? `${Math.round(remainingMins / 60 * 10) / 10}h` : `${remainingMins}m`} remaining</span>}
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2.5">
          <div className="h-2.5 rounded-full bg-purple-500 transition-all" style={{ width: `${modules.length ? (done / modules.length) * 100 : 0}%` }} />
        </div>
      </div>
      <div className="space-y-1.5">
        {modules.map((mod, i) => (
          <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${mod.completed ? "bg-purple-50 border border-purple-100" : "bg-white border border-border"}`}>
            <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center ${mod.completed ? "bg-purple-500" : "border-2 border-gray-300"}`}>
              {mod.completed && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            </div>
            <span className={`text-sm flex-1 leading-snug ${mod.completed ? "line-through text-muted-foreground" : "text-[#0A2540] font-medium"}`}>{mod.name}</span>
            {mod.durationMins && <span className="text-xs text-muted-foreground flex-shrink-0">{mod.durationMins}m</span>}
          </div>
        ))}
      </div>
      {tm.prerequisites && (
        <p className="text-xs text-muted-foreground border-l-2 border-purple-300 pl-3">Prerequisites: {tm.prerequisites}</p>
      )}
      {(remaining.length > 0 && tm.materialsUrl) && (
        <a href={tm.materialsUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-purple-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors">
          Launch Training
        </a>
      )}
    </div>
  );
}

function HealthCheckModalBody({ m }: { m: Record<string, unknown> }) {
  const hm = m as HealthCheckMetadata;
  if (!hm.healthStatus && !hm.outputSummary && !hm.lastRunDate) return <GenericModalBody m={m} />;
  return (
    <div className="space-y-3">
      {hm.outputSummary && (
        <div className="bg-[#F7F9FC] border border-border rounded-lg px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Output Summary</p>
          <p className="text-sm text-[#0A2540] leading-relaxed">{hm.outputSummary}</p>
        </div>
      )}
      {hm.lastRunDate && (
        <p className="text-xs text-muted-foreground">
          Last checked: <span className="font-semibold text-[#0A2540]">{new Date(hm.lastRunDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
        </p>
      )}
    </div>
  );
}

function GovernanceModalBody({ m }: { m: Record<string, unknown> }) {
  const gm = m as GovernanceMetadata;
  const allItems = [
    ...(gm.sensitivityLabels ?? []),
    ...(gm.dlpPolicies ?? []),
    ...(gm.conditionalAccess ?? []),
    ...(gm.configuredItems ?? []),
  ];
  if (!gm.postureSummary && allItems.length === 0) return <GenericModalBody m={m} />;
  return (
    <div className="space-y-4">
      {gm.postureSummary && (
        <p className="text-sm text-[#0A2540] leading-relaxed bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">{gm.postureSummary}</p>
      )}
      {allItems.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">What&apos;s been configured</p>
          <div className="space-y-1.5">
            {allItems.map((item, i) => (
              <div key={i} className="flex items-center gap-2.5 bg-white border border-border rounded-lg px-3 py-2">
                <span className="material-symbols-outlined text-blue-600 flex-shrink-0" style={{ fontSize: "16px" }}>check_circle</span>
                <span className="text-sm text-[#0A2540]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AutomationModalBody({ m }: { m: Record<string, unknown> }) {
  const flows = (m as AutomationMetadata).flows ?? [];
  if (flows.length === 0) return <GenericModalBody m={m} />;
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Your automations</p>
      <div className="space-y-1.5">
        {flows.map((flow, i) => (
          <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${flow.status === "error" ? "bg-orange-50 border-orange-200" : "bg-white border-border"}`}>
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${FLOW_DOT[flow.status] ?? "bg-gray-400"}`} />
            <span className="text-sm font-medium text-[#0A2540] flex-1 truncate">{flow.name}</span>
            <span className="text-xs text-muted-foreground flex-shrink-0">{FLOW_STATUS_LABEL[flow.status] ?? flow.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocumentModalBody({ m }: { m: Record<string, unknown> }) {
  const dm = m as DocumentMetadata;
  const docs = dm.documents ?? [];
  if (docs.length === 0) return <GenericModalBody m={m} />;
  return (
    <div className="space-y-2">
      {docs.map((doc, i) => (
        <div key={i} className={`rounded-lg border px-4 py-3 space-y-2 ${doc.approvalStatus === "revision_requested" ? "bg-amber-50 border-amber-200" : doc.approvalStatus === "approved" ? "bg-green-50 border-green-200" : "bg-white border-border"}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[#0A2540]">{doc.name}</p>
              {doc.version && <p className="text-[10px] text-muted-foreground">v{doc.version}</p>}
            </div>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${APPROVAL_CLS[doc.approvalStatus]}`}>
              {APPROVAL_LABEL[doc.approvalStatus]}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {doc.downloadUrl && (
              <a href={doc.downloadUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] hover:underline">
                ↓ Download
              </a>
            )}
            {doc.approvalStatus === "pending" && (
              <button onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 border border-teal-400 px-2.5 py-1 rounded-lg hover:bg-teal-50 transition-colors">
                Approve
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function DiscoveryModalBody({ m }: { m: Record<string, unknown> }) {
  const dm = m as DiscoveryMetadata;
  const recs = dm.recommendations ?? [];
  const riskCfg = dm.riskScore ? RISK_CFG[dm.riskScore] : null;
  if (!dm.riskScore && !dm.findingsSummary && recs.length === 0) return <GenericModalBody m={m} />;
  return (
    <div className="space-y-4">
      {riskCfg && (
        <span className={`inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full ${riskCfg.cls}`}>
          {riskCfg.label}
        </span>
      )}
      {dm.findingsSummary && (
        <div className={`border-l-4 rounded-r-lg px-4 py-3 ${dm.riskScore === "critical" || dm.riskScore === "high" ? "bg-red-50 border-red-400" : dm.riskScore === "medium" ? "bg-yellow-50 border-yellow-400" : "bg-gray-50 border-gray-300"}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Findings</p>
          <p className="text-sm text-[#0A2540] leading-relaxed">{dm.findingsSummary}</p>
        </div>
      )}
      {recs.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Recommended next steps</p>
          <ol className="space-y-2">
            {recs.map((r, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-pink-100 text-pink-700 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <span className="text-sm text-[#0A2540] leading-relaxed">{r}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {dm.assessmentUrl && (
        <ModalClientBtn label="Export Assessment" onClick={() => window.open(dm.assessmentUrl, "_blank")} />
      )}
    </div>
  );
}

export function TypedModalSection({
  taskType,
  metadata,
}: {
  taskType: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
}) {
  if (!taskType) return null;
  const cfg = TASK_TYPE_CONFIG[taskType as TaskType];
  if (!cfg) return null;
  const m = metadata ?? {};
  return (
    <div className="space-y-4">
      <div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${cfg.badge}`}>
          <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>{cfg.icon}</span>
          {cfg.label}
        </span>
      </div>
      {taskType === "training"               && <TrainingModalBody     m={m} />}
      {taskType === "environmentHealthCheck" && <HealthCheckModalBody  m={m} />}
      {taskType === "governanceSetup"        && <GovernanceModalBody   m={m} />}
      {taskType === "automationBuild"        && <AutomationModalBody   m={m} />}
      {taskType === "documentDelivery"       && <DocumentModalBody     m={m} />}
      {taskType === "discovery"              && <DiscoveryModalBody    m={m} />}
    </div>
  );
}

export function TypedTaskTypeBadge({ taskType }: { taskType: string | null | undefined }) {
  if (!taskType) return null;
  const cfg = TASK_TYPE_CONFIG[taskType as TaskType];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded ${cfg.badge}`}>
      <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}
