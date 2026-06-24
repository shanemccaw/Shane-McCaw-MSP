import { useState, useRef, useEffect } from "react";

export type TaskType =
  | "training"
  | "environmentHealthCheck"
  | "governanceSetup"
  | "automationBuild"
  | "documentDelivery"
  | "discovery"
  | "script";

export interface TrainingMetadata {
  modules?: Array<{ name: string; completed?: boolean; durationMins?: number }>;
  estimatedHours?: number;
  prerequisites?: string;
  materialsUrl?: string;
}

export interface HealthCheckMetadata {
  healthStatus?: "healthy" | "warning" | "critical";
  scriptName?: string;
  scriptVersion?: string;
  lastRunDate?: string;
  lastRunBy?: string;
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
    errorSnippet?: string;
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
  script: {
    label: "Script",
    badge: "bg-slate-100 text-slate-700 border border-slate-200",
    bar: "bg-slate-500",
    icon: "terminal",
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

function ActionBtn({
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        onClick?.();
      }}
      className="text-[9px] font-semibold px-2 py-1 rounded border border-border bg-[#1C2128] hover:bg-[#0078D4] hover:text-white hover:border-[#0078D4] transition-colors text-[#E6EDF3]"
    >
      {label}
    </button>
  );
}

function TrainingBody({ m }: { m: TrainingMetadata }) {
  const modules = m.modules ?? [];
  const done = modules.filter(mod => mod.completed).length;
  const remaining = modules.filter(mod => !mod.completed);
  return (
    <div className="space-y-2">
      {modules.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-semibold text-[#E6EDF3]">
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
              Next up: <span className="font-medium text-[#E6EDF3]">{remaining[0].name}</span>
            </p>
          )}
        </div>
      )}
      {m.prerequisites && (
        <p className="text-[10px] text-muted-foreground">
          Requires: {m.prerequisites}
        </p>
      )}
      <div className="flex gap-1 flex-wrap pt-1">
        <ActionBtn label="Launch Training" />
        {m.materialsUrl && <ActionBtn label="Download Materials" onClick={() => window.open(m.materialsUrl, "_blank")} />}
        <ActionBtn label="Mark Complete" />
      </div>
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
          <span className="font-medium text-[#E6EDF3]">
            {new Date(m.lastRunDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
          {m.lastRunBy && <span> by {m.lastRunBy}</span>}
        </p>
      )}
      {m.scriptName && (
        <p className="text-[10px] text-muted-foreground">
          Script: <span className="font-semibold text-[#E6EDF3]">{m.scriptName}</span>
          {m.scriptVersion && <span className="ml-1 text-muted-foreground">v{m.scriptVersion}</span>}
        </p>
      )}
      {m.outputSummary && (
        <p className="text-[10px] text-[#E6EDF3] leading-snug italic">{m.outputSummary}</p>
      )}
      <div className="flex gap-1 flex-wrap pt-1">
        <ActionBtn label="Run Again" />
        <ActionBtn label="View Output" />
        <ActionBtn label="Open Script" />
      </div>
    </div>
  );
}

function GovernanceBody({ m }: { m: GovernanceMetadata }) {
  const allItems = [
    ...(m.sensitivityLabels ?? []).map(l => `Sensitivity label: ${l}`),
    ...(m.dlpPolicies ?? []).map(p => `DLP policy: ${p}`),
    ...(m.conditionalAccess ?? []).map(c => `Conditional access: ${c}`),
    ...(m.configuredItems ?? []),
  ];
  return (
    <div className="space-y-2">
      {m.postureSummary && (
        <p className="text-[10px] text-[#E6EDF3] leading-snug">{m.postureSummary}</p>
      )}
      {allItems.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[#E6EDF3] mb-1">What's been configured:</p>
          <div className="space-y-0.5">
            {allItems.map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-blue-600 flex-shrink-0" style={{ fontSize: "13px" }}>check_circle</span>
                <span className="text-[10px] text-[#E6EDF3]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-1 flex-wrap pt-1">
        <ActionBtn label="Verify Configuration" />
        <ActionBtn label="Export Report" />
      </div>
    </div>
  );
}

function AutomationBody({ m }: { m: AutomationMetadata }) {
  const flows = m.flows ?? [];
  return (
    <div className="space-y-2">
      {flows.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[#E6EDF3] mb-1">Your automations:</p>
          <div className="space-y-1">
            {flows.map((flow, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${FLOW_DOT[flow.status] ?? "bg-gray-400"}`} />
                <span className="text-[10px] text-[#E6EDF3] truncate">{flow.name}</span>
                <span className="text-[9px] text-muted-foreground ml-auto flex-shrink-0">
                  {FLOW_STATUS_LABEL[flow.status] ?? flow.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-1 flex-wrap pt-1">
        <ActionBtn label="Run Test" />
        <ActionBtn label="Open Flow" />
        <ActionBtn label="View Logs" />
      </div>
    </div>
  );
}

function DocumentBody({ m }: { m: DocumentMetadata }) {
  const docs = m.documents ?? [];
  return (
    <div className="space-y-2">
      {docs.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[#E6EDF3] mb-1">Documents:</p>
          <div className="space-y-1.5">
            {docs.map((doc, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-medium text-[#E6EDF3] truncate">{doc.name}</p>
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
                      onClick={e => e.stopPropagation()}
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
      <div className="flex gap-1 flex-wrap pt-1">
        <ActionBtn label="Download All" />
        <ActionBtn label="Request Revision" />
        <ActionBtn label="Mark Approved" />
      </div>
    </div>
  );
}

const CARD_JOB_STATUS_CFG: Record<string, { cls: string; dot: string; label: string }> = {
  "Never run": { cls: "bg-gray-100 text-gray-500",   dot: "bg-gray-400",   label: "Never run" },
  "New":       { cls: "bg-blue-100 text-blue-700",   dot: "bg-blue-500 animate-pulse", label: "Queued" },
  "Activating":{ cls: "bg-blue-100 text-blue-700",   dot: "bg-blue-500 animate-pulse", label: "Activating" },
  "Running":   { cls: "bg-yellow-100 text-yellow-700", dot: "bg-yellow-400 animate-pulse", label: "Running" },
  "Completed": { cls: "bg-green-100 text-green-700", dot: "bg-green-500",  label: "Completed" },
  "Failed":    { cls: "bg-red-100 text-red-700",     dot: "bg-red-500",    label: "Failed" },
  "Stopped":   { cls: "bg-gray-100 text-gray-500",   dot: "bg-gray-400",   label: "Stopped" },
  "Suspended": { cls: "bg-orange-100 text-orange-700", dot: "bg-orange-400", label: "Suspended" },
};

function ScriptCardBody({ m }: { m: ScriptMetadata }) {
  const jobStatus = m.lastJobStatus ?? "Never run";
  const cfg = CARD_JOB_STATUS_CFG[jobStatus] ?? CARD_JOB_STATUS_CFG["Never run"];
  return (
    <div className="space-y-1">
      {m.runbookName && (
        <p className="text-[10px] font-mono text-muted-foreground truncate">{m.runbookName}</p>
      )}
      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
        {cfg.label}
      </span>
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
        <div className="bg-gray-50 border border-l-4 border-[#30363D] border-l-pink-400 rounded px-2 py-1.5 space-y-1.5">
          {m.findingsSummary && (
            <p className="text-[10px] text-[#E6EDF3] leading-snug">{m.findingsSummary}</p>
          )}
          {recs.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[#E6EDF3] mb-1">Recommended next steps:</p>
              <div className="space-y-0.5">
                {recs.map((r, i) => (
                  <div key={i} className="flex items-start gap-1">
                    <span className="material-symbols-outlined text-pink-500 flex-shrink-0" style={{ fontSize: "13px", marginTop: "1px" }}>arrow_right_alt</span>
                    <span className="text-[10px] text-[#E6EDF3]">{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="flex gap-1 flex-wrap pt-1">
        <ActionBtn label="Convert to Project" />
        {m.assessmentUrl && (
          <ActionBtn label="Export Assessment" onClick={() => window.open(m.assessmentUrl, "_blank")} />
        )}
      </div>
    </div>
  );
}

export function TypedCardContent({
  taskType,
  metadata,
}: {
  taskType: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
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
          {taskType === "training" && <TrainingBody m={metadata as TrainingMetadata} />}
          {taskType === "environmentHealthCheck" && <HealthCheckBody m={metadata as HealthCheckMetadata} />}
          {taskType === "governanceSetup" && <GovernanceBody m={metadata as GovernanceMetadata} />}
          {taskType === "automationBuild" && <AutomationBody m={metadata as AutomationMetadata} />}
          {taskType === "documentDelivery" && <DocumentBody m={metadata as DocumentMetadata} />}
          {taskType === "discovery" && <DiscoveryBody m={metadata as DiscoveryMetadata} />}
          {taskType === "script" && <ScriptCardBody m={metadata as ScriptMetadata} />}
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
    if (s === "critical") return { variant: "error", headline: "Requires immediate action", detail: m.outputSummary as string | undefined };
    if (s === "warning")  return { variant: "warning", headline: "Needs attention", detail: m.outputSummary as string | undefined };
    if (s === "healthy")  return { variant: "success", headline: "All systems healthy" };
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
    if (r === "critical") return { variant: "error",   headline: "Critical risk identified — immediate attention required" };
    if (r === "high")     return { variant: "warning",  headline: "High risk identified — review findings carefully" };
  }

  return null;
}

// ── Per-type modal body components ────────────────────────────────────────────

function ModalActionBtn({ label, onClick, variant = "default" }: {
  label: string;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger";
}) {
  const cls = {
    default:  "text-sm font-semibold text-[#E6EDF3] border border-border bg-[#1C2128] hover:bg-[#30363D]",
    primary:  "text-sm font-semibold text-white bg-[#0078D4] hover:bg-[#0078D4]/90",
    danger:   "text-sm font-semibold text-red-400 border border-red-500/30 bg-[#1C2128] hover:bg-red-500/10",
  }[variant];
  return (
    <button onClick={e => { e.stopPropagation(); onClick?.(); }}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${cls}`}>
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
            <span className="text-sm font-semibold text-[#E6EDF3]">{done}/{checklist.length} steps complete</span>
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
                <span className="text-sm text-[#E6EDF3]">{d}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrainingModalBody({ m, mode }: { m: Record<string, unknown>; mode: "admin" | "client" }) {
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
          <span className="text-sm font-semibold text-[#E6EDF3]">{done}/{modules.length} modules complete</span>
          {remainingMins > 0 && <span className="text-xs text-muted-foreground">~{remainingMins >= 60 ? `${Math.round(remainingMins / 60 * 10) / 10}h` : `${remainingMins}m`} remaining</span>}
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2.5">
          <div className="h-2.5 rounded-full bg-purple-500 transition-all" style={{ width: `${modules.length ? (done / modules.length) * 100 : 0}%` }} />
        </div>
      </div>
      <div className="space-y-1.5">
        {modules.map((mod, i) => (
          <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${mod.completed ? "bg-purple-500/10 border border-purple-500/20" : "bg-[#1C2128] border border-border"}`}>
            <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center ${mod.completed ? "bg-purple-500" : "border-2 border-gray-300"}`}>
              {mod.completed && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            </div>
            <span className={`text-sm flex-1 leading-snug ${mod.completed ? "line-through text-muted-foreground" : "text-[#E6EDF3] font-medium"}`}>{mod.name}</span>
            {mod.durationMins && <span className="text-xs text-muted-foreground flex-shrink-0">{mod.durationMins}m</span>}
          </div>
        ))}
      </div>
      {tm.prerequisites && (
        <p className="text-xs text-muted-foreground border-l-2 border-purple-300 pl-3">Prerequisites: {tm.prerequisites}</p>
      )}
      <div className="flex gap-2 flex-wrap">
        {remaining.length > 0 && tm.materialsUrl && (
          <ModalActionBtn label="Launch Training" variant="primary" onClick={() => window.open(tm.materialsUrl, "_blank")} />
        )}
        {tm.materialsUrl && <ModalActionBtn label="Download Materials" onClick={() => window.open(tm.materialsUrl, "_blank")} />}
        {mode === "admin" && <ModalActionBtn label="Mark All Complete" />}
      </div>
    </div>
  );
}

function HealthCheckModalBody({ m, mode }: { m: Record<string, unknown>; mode: "admin" | "client" }) {
  const hm = m as HealthCheckMetadata;
  const hasTypeData = !!(hm.healthStatus || hm.outputSummary || hm.lastRunDate);
  if (!hasTypeData) return <GenericModalBody m={m} />;
  return (
    <div className="space-y-4">
      {hm.outputSummary && (
        <div className="bg-[#1C2128] border border-border rounded-lg px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Output Summary</p>
          <p className="text-sm text-[#E6EDF3] leading-relaxed">{hm.outputSummary}</p>
        </div>
      )}
      {(hm.lastRunDate || (mode === "admin" && hm.lastRunBy)) && (
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {hm.lastRunDate && (
            <span>Last run: <span className="font-semibold text-[#E6EDF3]">{new Date(hm.lastRunDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></span>
          )}
          {mode === "admin" && hm.lastRunBy && <span>by <span className="font-semibold text-[#E6EDF3]">{hm.lastRunBy}</span></span>}
        </div>
      )}
      {mode === "admin" && hm.scriptName && (
        <div className="bg-gray-900 text-gray-100 rounded-lg px-4 py-3 font-mono text-xs">
          <span className="text-gray-400">script</span>  {hm.scriptName}{hm.scriptVersion ? ` v${hm.scriptVersion}` : ""}
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {mode === "admin" && hm.healthStatus && hm.healthStatus !== "healthy" && <ModalActionBtn label="Run Again" variant="primary" />}
        {mode === "admin" && hm.outputSummary && <ModalActionBtn label="View Full Output" />}
        {mode === "admin" && hm.scriptName && <ModalActionBtn label="Open Script" />}
      </div>
    </div>
  );
}

function GovernanceModalBody({ m, mode }: { m: Record<string, unknown>; mode: "admin" | "client" }) {
  const gm = m as GovernanceMetadata;
  const sections: Array<{ label: string; items: string[] }> = [
    { label: "Sensitivity Labels", items: gm.sensitivityLabels ?? [] },
    { label: "DLP Policies", items: gm.dlpPolicies ?? [] },
    { label: "Conditional Access", items: gm.conditionalAccess ?? [] },
    { label: "Configured Items", items: gm.configuredItems ?? [] },
  ].filter(s => s.items.length > 0);
  const hasTypeData = !!(gm.postureSummary || sections.length > 0);
  if (!hasTypeData) return <GenericModalBody m={m} />;
  return (
    <div className="space-y-4">
      {gm.postureSummary && (
        <p className="text-sm text-[#E6EDF3] leading-relaxed bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">{gm.postureSummary}</p>
      )}
      {sections.map(sec => (
        <div key={sec.label}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{sec.label}</p>
          <div className="space-y-1.5">
            {sec.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2.5 bg-[#1C2128] border border-border rounded-lg px-3 py-2">
                <span className="material-symbols-outlined text-blue-600 flex-shrink-0" style={{ fontSize: "16px" }}>check_circle</span>
                <span className="text-sm text-[#E6EDF3]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {mode === "admin" && (
        <div className="flex gap-2 flex-wrap">
          <ModalActionBtn label="Verify Configuration" />
          <ModalActionBtn label="Export Report" />
        </div>
      )}
    </div>
  );
}

function AutomationModalBody({ m, mode }: { m: Record<string, unknown>; mode: "admin" | "client" }) {
  const am = m as AutomationMetadata & { flows?: Array<{ name: string; status: string; trigger?: string; lastRun?: string; errorSnippet?: string }> };
  const flows = am.flows ?? [];
  if (flows.length === 0) return <GenericModalBody m={m} />;
  const errorFlows = flows.filter(f => f.status === "error");
  return (
    <div className="space-y-4">
      {errorFlows.length > 0 && mode === "admin" && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-600">Flows needing attention</p>
          {errorFlows.map((f, i) => (
            <div key={i}>
              <p className="text-sm font-semibold text-red-800">{f.name}</p>
              {f.errorSnippet && (
                <pre className="mt-1 text-xs text-red-700 bg-red-100 rounded px-2 py-1 font-mono whitespace-pre-wrap">{f.errorSnippet}</pre>
              )}
            </div>
          ))}
        </div>
      )}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Automations</p>
        <div className="space-y-1.5">
          {flows.map((flow, i) => (
            <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${flow.status === "error" ? "bg-red-500/10 border-red-500/20" : "bg-[#1C2128] border-border"}`}>
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${FLOW_DOT[flow.status] ?? "bg-gray-400"}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${flow.status === "error" ? "text-red-800" : "text-[#E6EDF3]"}`}>{flow.name}</p>
                {mode === "admin" && flow.trigger && <p className="text-[10px] text-muted-foreground">Trigger: {flow.trigger}</p>}
              </div>
              <span className={`text-xs font-semibold flex-shrink-0 ${flow.status === "error" ? "text-red-700" : "text-muted-foreground"}`}>
                {FLOW_STATUS_LABEL[flow.status] ?? flow.status}
              </span>
            </div>
          ))}
        </div>
      </div>
      {mode === "admin" && (
        <div className="flex gap-2 flex-wrap">
          <ModalActionBtn label="Run Test" variant="primary" />
          <ModalActionBtn label="View Logs" />
          <ModalActionBtn label="Open in Power Automate" />
        </div>
      )}
    </div>
  );
}

function DocumentModalBody({ m, mode }: { m: Record<string, unknown>; mode: "admin" | "client" }) {
  const dm = m as DocumentMetadata;
  const docs = dm.documents ?? [];
  if (docs.length === 0) return <GenericModalBody m={m} />;
  const hasDownloads = docs.some(d => d.downloadUrl);
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {docs.map((doc, i) => (
          <div key={i} className={`rounded-lg border px-4 py-3 space-y-2 ${doc.approvalStatus === "revision_requested" ? "bg-amber-500/10 border-amber-500/20" : doc.approvalStatus === "approved" ? "bg-green-500/10 border-green-500/20" : "bg-[#1C2128] border-border"}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[#E6EDF3]">{doc.name}</p>
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
              {doc.approvalStatus === "pending" && mode === "client" && (
                <button onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 border border-teal-400 px-2.5 py-1 rounded-lg hover:bg-teal-50 transition-colors">
                  Approve
                </button>
              )}
              {doc.approvalStatus === "pending" && mode === "admin" && (
                <button onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 border border-amber-400 px-2.5 py-1 rounded-lg hover:bg-amber-50 transition-colors">
                  Request Revision
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {hasDownloads && <ModalActionBtn label="Download All" />}
    </div>
  );
}

function DiscoveryModalBody({ m, mode }: { m: Record<string, unknown>; mode: "admin" | "client" }) {
  const dm = m as DiscoveryMetadata;
  const recs = dm.recommendations ?? [];
  const riskCfg = dm.riskScore ? RISK_CFG[dm.riskScore] : null;
  const hasTypeData = !!(dm.riskScore || dm.findingsSummary || recs.length > 0);
  if (!hasTypeData) return <GenericModalBody m={m} />;
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
          <p className="text-sm text-[#E6EDF3] leading-relaxed">{dm.findingsSummary}</p>
        </div>
      )}
      {recs.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Recommended next steps</p>
          <ol className="space-y-2">
            {recs.map((r, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-pink-100 text-pink-700 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <span className="text-sm text-[#E6EDF3] leading-relaxed">{r}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {dm.assessmentUrl && (
          <ModalActionBtn label="Export Assessment" onClick={() => window.open(dm.assessmentUrl, "_blank")} />
        )}
        {mode === "admin" && <ModalActionBtn label="Convert to Project" variant="primary" />}
      </div>
    </div>
  );
}

export const GOVERNANCE_AREAS = [
  "Teams",
  "SharePoint",
  "Exchange",
  "EntraID",
  "Licensing",
  "SecureScore",
  "DLP",
  "Retention",
  "SensitivityLabels",
] as const;

export type GovernanceArea = (typeof GOVERNANCE_AREAS)[number];

export function GovernanceAreasPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string[] | null;
  onChange: (areas: string[] | null) => void;
  disabled?: boolean;
}) {
  const isAll = value === null;

  const toggleAll = () => {
    if (isAll) {
      onChange([]);
    } else {
      onChange(null);
    }
  };

  const toggleArea = (area: string) => {
    if (isAll) {
      onChange([area]);
    } else {
      const current = value ?? [];
      if (current.includes(area)) {
        const next = current.filter(a => a !== area);
        onChange(next.length === 0 ? null : next);
      } else {
        onChange([...current, area]);
      }
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Microsoft Product Areas</p>
      <label className={`flex items-center gap-2 cursor-pointer ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
        <input
          type="checkbox"
          checked={isAll}
          onChange={toggleAll}
          disabled={disabled}
          className="accent-[#0078D4]"
        />
        <span className="text-sm font-semibold text-[#E6EDF3]">ALL</span>
        <span className="text-[10px] text-muted-foreground">(runs across all areas)</span>
      </label>
      <div className={`grid grid-cols-2 gap-y-1.5 gap-x-2 pl-2 ${isAll ? "opacity-40" : ""}`}>
        {GOVERNANCE_AREAS.map(area => (
          <label
            key={area}
            className={`flex items-center gap-2 cursor-pointer ${(disabled || isAll) ? "pointer-events-none" : ""}`}
          >
            <input
              type="checkbox"
              checked={!isAll && (value?.includes(area) ?? false)}
              onChange={() => toggleArea(area)}
              disabled={disabled || isAll}
              className="accent-[#0078D4]"
            />
            <span className="text-xs text-[#E6EDF3]">{area}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export interface ScriptMetadata {
  runbookName?: string;
  credentialId?: number;
  credentialName?: string;
  lastJobId?: string;
  lastJobStatus?: string;
  governanceAreas?: string[] | null;
}

const JOB_STATUS_CFG: Record<string, { cls: string; label: string }> = {
  "Never run":  { cls: "bg-gray-100 text-gray-600 border border-[#30363D]", label: "Never run" },
  "New":        { cls: "bg-blue-100 text-blue-700 border border-blue-200", label: "Queued" },
  "Activating": { cls: "bg-blue-100 text-blue-700 border border-blue-200", label: "Activating" },
  "Running":    { cls: "bg-yellow-100 text-yellow-700 border border-yellow-200", label: "Running" },
  "Completed":  { cls: "bg-green-100 text-green-700 border border-green-200", label: "Completed" },
  "Failed":     { cls: "bg-red-100 text-red-700 border border-red-200", label: "Failed" },
  "Stopped":    { cls: "bg-gray-100 text-gray-600 border border-[#30363D]", label: "Stopped" },
  "Suspended":  { cls: "bg-orange-100 text-orange-700 border border-orange-200", label: "Suspended" },
};

function ScriptModalBody({
  taskId,
  m,
  mode,
  fetchWithAuth,
  onMetadataUpdate,
}: {
  taskId: number;
  m: Record<string, unknown>;
  mode: "admin" | "client";
  fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
  onMetadataUpdate?: (meta: Record<string, unknown>) => void;
}) {
  const sm = m as ScriptMetadata;
  const [running, setRunning] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [liveStatus, setLiveStatus] = useState<string>(sm.lastJobStatus ?? "Never run");
  const logEndRef = useRef<HTMLDivElement>(null);

  const initAreas = (sm.governanceAreas !== undefined ? sm.governanceAreas : null) as string[] | null;
  const [governanceAreas, setGovernanceAreas] = useState<string[] | null>(initAreas);

  const canRun = !!sm.runbookName && !!sm.credentialId && !running && (governanceAreas === null || governanceAreas.length > 0);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  const handleRun = async () => {
    if (!fetchWithAuth || !sm.credentialId || !sm.runbookName) return;
    setRunning(true);
    setLogLines(["[Starting job…]"]);
    setLiveStatus("New");

    const areasPayload = governanceAreas !== null && governanceAreas.length > 0 ? governanceAreas : undefined;

    try {
      await fetchWithAuth(`/api/admin/kanban-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskMetadata: { ...m, governanceAreas: governanceAreas } }),
      });
    } catch {
    }

    try {
      const res = await fetchWithAuth("/api/admin/runbook-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialId: sm.credentialId,
          runbookName: sm.runbookName,
          kanbanTaskId: taskId,
          ...(areasPayload ? { governanceAreas: areasPayload } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setLogLines(prev => [...prev, `[Error: ${err.error ?? "Failed to start job"}]`]);
        setRunning(false);
        return;
      }

      const { jobId } = await res.json() as { jobId: string; status: string };

      let lastSeq = -1;
      let aborted = false;

      const poll = async (): Promise<void> => {
        if (aborted) return;
        try {
          const url = `/api/admin/runbook-jobs/output?jobId=${encodeURIComponent(jobId)}&since=${lastSeq}&kanbanTaskId=${taskId}`;
          const pollRes = await fetchWithAuth(url);
          if (!pollRes.ok) throw new Error("poll failed");
          const data = await pollRes.json() as {
            status: string;
            terminal: boolean;
            lines: Array<{ sequence: number; text: string; streamType?: string }>;
          };

          setLiveStatus(data.status);
          if (data.lines.length > 0) {
            setLogLines(prev => [...prev, ...data.lines.map(l => l.text)]);
            lastSeq = Math.max(...data.lines.map(l => l.sequence));
          }

          if (data.terminal) {
            setLogLines(prev => [...prev, `[Job ${data.status}]`]);
            setRunning(false);
            onMetadataUpdate?.({ ...m, lastJobId: jobId, lastJobStatus: data.status });
            return;
          }

          setTimeout(() => void poll(), 3000);
        } catch {
          if (!aborted) {
            setLogLines(prev => [...prev, "[Polling error — job may still be running in Azure]"]);
            setRunning(false);
          }
        }
      };

      void poll();
    } catch {
      setLogLines(prev => [...prev, "[Network error — could not start job]"]);
      setRunning(false);
    }
  };

  const statusCfg = JOB_STATUS_CFG[liveStatus] ?? { cls: "bg-gray-100 text-gray-600 border border-[#30363D]", label: liveStatus };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 space-y-1 min-w-0">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Runbook</p>
            <p className="text-sm font-semibold text-[#E6EDF3] font-mono truncate">{sm.runbookName ?? <span className="italic font-normal text-muted-foreground">Not configured</span>}</p>
          </div>
          {sm.credentialName && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Customer</p>
              <p className="text-sm text-[#E6EDF3]">{sm.credentialName}</p>
            </div>
          )}
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusCfg.cls}`}>{statusCfg.label}</span>
      </div>

      {mode === "admin" && (
        <div className="bg-[#1C2128] border border-border rounded-lg p-3">
          <GovernanceAreasPicker
            value={governanceAreas}
            onChange={setGovernanceAreas}
            disabled={running}
          />
        </div>
      )}

      {mode === "admin" && sm.runbookName && sm.credentialId && (
        <button
          type="button"
          disabled={!canRun}
          onClick={() => void handleRun()}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-[#0078D4] hover:bg-[#0078D4]/90 disabled:opacity-40 rounded-lg px-4 py-2 transition-colors"
        >
          {running ? (
            <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>play_arrow</span>
          )}
          {running ? "Running…" : "Run"}
        </button>
      )}

      {logLines.length > 0 && (
        <div className="bg-gray-900 rounded-lg p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Output</span>
            {!running && (
              <button
                type="button"
                onClick={() => setLogLines([])}
                className="text-[9px] font-semibold text-gray-400 hover:text-white transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <div className="font-mono text-xs text-gray-100 space-y-0.5">
            {logLines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all leading-relaxed">{line}</div>
            ))}
          </div>
          <div ref={logEndRef} />
        </div>
      )}

      {(!sm.runbookName || !sm.credentialId) && mode === "admin" && (
        <p className="text-xs text-amber-700 bg-amber-500/10 border border-amber-200 rounded-lg px-3 py-2">
          This task is not fully configured. Set a Runbook and Customer via task metadata to enable execution.
        </p>
      )}
    </div>
  );
}

export function TypedModalSection({
  taskType,
  metadata,
  mode = "client",
  taskId,
  fetchWithAuth,
  onMetadataUpdate,
}: {
  taskType: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
  mode?: "admin" | "client";
  taskId?: number;
  fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
  onMetadataUpdate?: (meta: Record<string, unknown>) => void;
}) {
  if (!taskType) return null;
  const cfg = TASK_TYPE_CONFIG[taskType as TaskType];
  if (!cfg) return null;
  const m = metadata ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${cfg.badge}`}>
          <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>{cfg.icon}</span>
          {cfg.label}
        </span>
      </div>
      {taskType === "training" && <TrainingModalBody m={m} mode={mode} />}
      {taskType === "environmentHealthCheck" && <HealthCheckModalBody m={m} mode={mode} />}
      {taskType === "governanceSetup" && <GovernanceModalBody m={m} mode={mode} />}
      {taskType === "automationBuild" && <AutomationModalBody m={m} mode={mode} />}
      {taskType === "documentDelivery" && <DocumentModalBody m={m} mode={mode} />}
      {taskType === "discovery" && <DiscoveryModalBody m={m} mode={mode} />}
      {taskType === "script" && taskId !== undefined && (
        <ScriptModalBody
          taskId={taskId}
          m={m}
          mode={mode}
          fetchWithAuth={fetchWithAuth}
          onMetadataUpdate={onMetadataUpdate}
        />
      )}
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
