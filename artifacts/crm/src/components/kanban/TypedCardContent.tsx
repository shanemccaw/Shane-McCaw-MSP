import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

export type TaskType =
  | "training"
  | "environmentHealthCheck"
  | "governanceSetup"
  | "automationBuild"
  | "documentDelivery"
  | "discovery"
  | "manualScript";

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

export interface ManualScriptMetadata {
  scriptId?: number;
  scriptRunResultId?: number;
  projectId?: number;
  instructions?: string[];
  checklist?: Array<{ id: string; label: string }>;
  checklistState?: Record<string, boolean>;
  clientDeliverables?: string[];
  uploadedArtifacts?: string[];
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
  manualScript: {
    label: "Manual Script",
    badge: "bg-cyan-100 text-cyan-700 border border-cyan-200",
    bar: "bg-cyan-500",
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

function ManualScriptBody() {
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground">Click Details to download the script and upload results.</p>
    </div>
  );
}

function GenericBody({ m }: { m: Record<string, unknown> }) {
  const deliverables = (m.clientDeliverables as string[] | undefined) ?? [];

  if (deliverables.length === 0) return null;

  return (
    <div className="space-y-2">
      <div>
        <p className="text-[10px] font-semibold text-[#0A2540] mb-0.5">What I&apos;m gathering:</p>
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
          {taskType === "manualScript" && <ManualScriptBody />}
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
  if (deliverables.length === 0) return null;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">What I&apos;m gathering</p>
        <div className="space-y-1.5">
          {deliverables.map((d, i) => (
            <div key={i} className="flex items-center gap-2.5 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-[#0078D4] flex-shrink-0" />
              <span className="text-sm text-[#0A2540]">{d}</span>
            </div>
          ))}
        </div>
      </div>
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

function ManualScriptModalBody({ m }: { m: Record<string, unknown> }) {
  const mm = m as ManualScriptMetadata;
  const checklist = mm.checklist ?? [];
  const checklistState = mm.checklistState ?? {};
  const instructions = mm.instructions ?? [];
  const runResultId = mm.scriptRunResultId;
  const projectId = mm.projectId;
  const done = checklist.filter(item => checklistState[item.id]).length;
  const total = checklist.length;

  const { fetchWithAuth, user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [downloading, setDownloading] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "processing" | "done">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownload = useCallback(async () => {
    if (!runResultId || downloading) return;
    setDownloading(true);
    try {
      const url = isAdmin
        ? `/api/admin/manual-scripts/${runResultId}/download`
        : `/api/portal/projects/${projectId}/manual-scripts/${runResultId}/download`;
      const res = await fetchWithAuth(url);
      if (!res.ok) { setDownloading(false); return; }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(cd);
      a.download = match?.[1] ?? `script_${runResultId}.ps1`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } finally {
      setDownloading(false);
    }
  }, [runResultId, projectId, isAdmin, fetchWithAuth, downloading]);

  const processUploadFile = useCallback(async (file: File) => {
    if (!runResultId) return;
    setUploadError(null);
    if (!file.name.endsWith(".json") && file.type !== "application/json") {
      setUploadError("Only .json files are accepted. Please upload the JSON output file created by the PowerShell script.");
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(await file.text()) as Record<string, unknown>;
    } catch {
      setUploadError("The file is not valid JSON. Upload the exact JSON file the PowerShell script generated.");
      return;
    }
    if (!("data" in parsed)) {
      setUploadError("The JSON is missing the required 'data' key. Make sure you are uploading the file created by the downloaded script.");
      return;
    }
    setUploadStatus("processing");
    try {
      const url = isAdmin
        ? `/api/admin/manual-scripts/${runResultId}/upload`
        : `/api/portal/manual-scripts/${runResultId}/upload`;
      const res = await fetchWithAuth(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonData: parsed }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setUploadError(body.error ?? "Upload failed. Please try again.");
        setUploadStatus("idle");
        return;
      }
      setUploadStatus("done");
    } catch {
      setUploadError("Upload failed due to a network error. Check your connection and try again.");
      setUploadStatus("idle");
    }
  }, [runResultId, isAdmin, fetchWithAuth]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processUploadFile(file);
    e.target.value = "";
  }, [processUploadFile]);

  return (
    <div className="space-y-5">
      {runResultId && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Actions</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="flex items-center justify-center gap-2 w-full bg-[#0A2540] text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-[#0A2540]/90 disabled:opacity-50 transition-colors"
            >
              {downloading
                ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Downloading…</>
                : <><span>⬇</span> Download Script (.ps1)</>}
            </button>

            <button
              onClick={() => setShowInstructions(o => !o)}
              className="flex items-center justify-center gap-2 w-full bg-white border border-border text-[#0A2540] text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <span>📄</span> {showInstructions ? "Hide Instructions" : "View Instructions"}
            </button>

            {showInstructions && instructions.length > 0 && (
              <div className="bg-[#F7F9FC] border border-border rounded-lg p-4">
                <ol className="space-y-2">
                  {instructions.map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-100 text-cyan-700 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                      <span className="text-sm text-[#0A2540] leading-relaxed">{step.replace(/\*\*/g, "")}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {uploadStatus === "done" ? (
              <div className="flex items-center gap-2.5 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-semibold text-green-800">Results received — thank you!</span>
              </div>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="sr-only"
                  disabled={uploadStatus === "processing"}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadStatus === "processing"}
                  className="flex items-center justify-center gap-2 w-full bg-cyan-600 text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-cyan-700 disabled:opacity-50 transition-colors"
                >
                  {uploadStatus === "processing"
                    ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Processing…</>
                    : <><span>⬆</span> Upload Results (.json)</>}
                </button>
                {uploadError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{uploadError}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {total > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Progress</p>
            <span className="text-xs text-muted-foreground">{done}/{total} complete</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5 mb-3">
            <div className="h-2.5 rounded-full bg-cyan-500 transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <div className="space-y-1.5">
            {checklist.map(item => (
              <div key={item.id} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${checklistState[item.id] ? "bg-cyan-50 border-cyan-100" : "bg-white border-border"}`}>
                <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center border-2 ${checklistState[item.id] ? "bg-cyan-500 border-cyan-500" : "border-gray-300"}`}>
                  {checklistState[item.id] && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  )}
                </div>
                <span className={`text-sm flex-1 leading-snug ${checklistState[item.id] ? "line-through text-muted-foreground" : "text-[#0A2540] font-medium"}`}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
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

interface AutoSavedAiAnalysis {
  summary?: string;
  risks?: string[];
  recommendations?: string[];
  nextSteps?: string[];
}

function AutoSavedScriptResultsSection({
  scriptOutput,
  aiAnalysis,
  completedAt,
  failedAt,
  lastJobStatus,
}: {
  scriptOutput?: string;
  aiAnalysis?: AutoSavedAiAnalysis;
  completedAt?: string;
  failedAt?: string;
  lastJobStatus?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  const timestamp = completedAt ?? failedAt;
  const isFailure = !!failedAt && !completedAt;
  const statusLabel = lastJobStatus ?? (isFailure ? "Failed" : "Completed");
  const formattedDate = timestamp
    ? new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  const hasAi = !!(aiAnalysis?.summary || (aiAnalysis?.risks?.length ?? 0) > 0 || (aiAnalysis?.recommendations?.length ?? 0) > 0);
  const hasOutput = !!scriptOutput?.trim();

  if (!hasAi && !hasOutput) return null;

  return (
    <div className={`border rounded-lg overflow-hidden ${isFailure ? "border-red-200" : "border-emerald-200"}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${isFailure ? "bg-red-50 hover:bg-red-100/60" : "bg-emerald-50 hover:bg-emerald-100/60"}`}
      >
        <div className="flex items-center gap-2">
          <svg className={`w-3.5 h-3.5 flex-shrink-0 ${isFailure ? "text-red-600" : "text-emerald-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
          </svg>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${isFailure ? "text-red-700" : "text-emerald-700"}`}>
            Auto-Run Results · {statusLabel}
          </p>
          {formattedDate && <span className="text-[9px] text-muted-foreground">{formattedDate}</span>}
        </div>
        <span className="material-symbols-outlined text-muted-foreground flex-shrink-0" style={{ fontSize: "16px" }}>
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div className="px-4 py-3 border-t border-border space-y-3 bg-white">
          {aiAnalysis?.summary && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Summary</p>
              <p className="text-xs text-[#0A2540] leading-relaxed">{aiAnalysis.summary}</p>
            </div>
          )}

          {(aiAnalysis?.risks?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-red-600 mb-1.5">Risks</p>
              <ul className="space-y-1">
                {aiAnalysis!.risks!.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#0A2540]">
                    <span className="text-red-500 mt-0.5 flex-shrink-0">⚠</span>
                    <span className="leading-relaxed">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(aiAnalysis?.recommendations?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Recommendations</p>
              <ol className="space-y-1">
                {aiAnalysis!.recommendations!.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#0A2540]">
                    <span className="text-emerald-600 mt-0.5 flex-shrink-0 font-semibold">{i + 1}.</span>
                    <span className="leading-relaxed">{rec}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {(aiAnalysis?.nextSteps?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Next Steps</p>
              <ol className="space-y-1">
                {aiAnalysis!.nextSteps!.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#0A2540]">
                    <span className="text-[#0078D4] mt-0.5 flex-shrink-0">→</span>
                    <span className="leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {hasOutput && (
            <div>
              <button
                onClick={() => setShowOutput(o => !o)}
                className="text-[10px] font-semibold text-[#0078D4] hover:underline flex items-center gap-1"
              >
                <svg className={`w-3 h-3 transition-transform ${showOutput ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                {showOutput ? "Hide" : "Show"} raw output
              </button>
              {showOutput && (
                <pre className="mt-2 text-[10px] text-[#374151] bg-[#F7F9FC] border border-border rounded-lg px-3 py-2.5 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                  {scriptOutput}
                </pre>
              )}
            </div>
          )}
        </div>
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

  const scriptOutput = m.scriptOutput as string | undefined;
  const aiAnalysis = m.aiAnalysis as AutoSavedAiAnalysis | undefined;
  const completedAt = m.completedAt as string | undefined;
  const failedAt = m.failedAt as string | undefined;
  const lastJobStatus = m.lastJobStatus as string | undefined;
  const hasAutoSaved = !!(scriptOutput || aiAnalysis);

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
      {taskType === "manualScript"           && <ManualScriptModalBody m={m} />}
      {hasAutoSaved && (
        <AutoSavedScriptResultsSection
          scriptOutput={scriptOutput}
          aiAnalysis={aiAnalysis}
          completedAt={completedAt}
          failedAt={failedAt}
          lastJobStatus={lastJobStatus}
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
