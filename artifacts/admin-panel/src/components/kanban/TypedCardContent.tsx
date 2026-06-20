import { useState } from "react";

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
    icon: "🎓",
  },
  environmentHealthCheck: {
    label: "Health Check",
    badge: "bg-green-100 text-green-700 border border-green-200",
    bar: "bg-green-500",
    icon: "🔍",
  },
  governanceSetup: {
    label: "Governance",
    badge: "bg-blue-100 text-blue-700 border border-blue-200",
    bar: "bg-blue-500",
    icon: "🛡️",
  },
  automationBuild: {
    label: "Automation",
    badge: "bg-orange-100 text-orange-700 border border-orange-200",
    bar: "bg-orange-500",
    icon: "⚡",
  },
  documentDelivery: {
    label: "Document",
    badge: "bg-amber-100 text-amber-700 border border-amber-200",
    bar: "bg-amber-500",
    icon: "📄",
  },
  discovery: {
    label: "Discovery",
    badge: "bg-pink-100 text-pink-700 border border-pink-200",
    bar: "bg-pink-500",
    icon: "🔬",
  },
};

const RISK_CFG = {
  low: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const HEALTH_CFG = {
  healthy: "bg-green-100 text-green-700",
  warning: "bg-yellow-100 text-yellow-700",
  critical: "bg-red-100 text-red-700",
};

const FLOW_STATUS_CFG = {
  live: "bg-green-100 text-green-700",
  testing: "bg-blue-100 text-blue-700",
  building: "bg-gray-100 text-gray-600",
  error: "bg-red-100 text-red-700",
};

const APPROVAL_CFG = {
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
      className="text-[9px] font-semibold px-2 py-1 rounded border border-border bg-white hover:bg-[#0078D4] hover:text-white hover:border-[#0078D4] transition-colors text-[#0A2540]"
    >
      {label}
    </button>
  );
}

function TrainingBody({ m }: { m: TrainingMetadata }) {
  const modules = m.modules ?? [];
  const done = modules.filter(mod => mod.completed).length;
  return (
    <div className="space-y-2">
      {modules.length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
            Modules ({done}/{modules.length})
          </p>
          <div className="w-full bg-gray-100 rounded-full h-1.5 mb-1.5">
            <div
              className="h-1.5 rounded-full bg-purple-500"
              style={{ width: `${modules.length ? (done / modules.length) * 100 : 0}%` }}
            />
          </div>
          <div className="space-y-0.5">
            {modules.map((mod, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span
                  className={`w-3 h-3 rounded-full flex items-center justify-center flex-shrink-0 text-[8px] ${mod.completed ? "bg-purple-500 text-white" : "bg-gray-200 text-gray-400"}`}
                >
                  {mod.completed ? "✓" : "○"}
                </span>
                <span className="text-[10px] text-[#0A2540] truncate">{mod.name}</span>
                {mod.durationMins && (
                  <span className="text-[9px] text-muted-foreground ml-auto flex-shrink-0">
                    {mod.durationMins}m
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {m.estimatedHours && (
        <p className="text-[10px] text-muted-foreground">
          ⏱ Est. {m.estimatedHours}h total
        </p>
      )}
      {m.prerequisites && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Prerequisites</p>
          <p className="text-[10px] text-[#0A2540]">{m.prerequisites}</p>
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
        <ActionBtn label="Launch Training" />
        {m.materialsUrl && <ActionBtn label="Download Materials" onClick={() => window.open(m.materialsUrl, "_blank")} />}
        <ActionBtn label="Mark Complete" />
      </div>
    </div>
  );
}

function HealthCheckBody({ m }: { m: HealthCheckMetadata }) {
  return (
    <div className="space-y-2">
      {m.healthStatus && (
        <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full ${HEALTH_CFG[m.healthStatus]}`}>
          {m.healthStatus === "healthy" ? "✓ Healthy" : m.healthStatus === "warning" ? "⚠ Warning" : "✖ Critical"}
        </span>
      )}
      {m.scriptName && (
        <p className="text-[10px] text-muted-foreground">
          Script: <span className="font-semibold text-[#0A2540]">{m.scriptName}</span>
          {m.scriptVersion && <span className="ml-1 text-muted-foreground">v{m.scriptVersion}</span>}
        </p>
      )}
      {m.lastRunDate && (
        <p className="text-[10px] text-muted-foreground">
          Last run: {new Date(m.lastRunDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          {m.lastRunBy && <span> by {m.lastRunBy}</span>}
        </p>
      )}
      {m.outputSummary && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Output</p>
          <pre className="text-[9px] bg-gray-50 border border-border rounded px-2 py-1 whitespace-pre-wrap font-mono max-h-16 overflow-y-auto">
            {m.outputSummary}
          </pre>
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
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
        <p className="text-[10px] text-[#0A2540] leading-snug">{m.postureSummary}</p>
      )}
      {allItems.length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Configured</p>
          <div className="space-y-0.5">
            {allItems.map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-blue-100 flex items-center justify-center text-[8px] text-blue-700 flex-shrink-0">✓</span>
                <span className="text-[10px] text-[#0A2540]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
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
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Flows</p>
          <div className="space-y-1">
            {flows.map((flow, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${FLOW_STATUS_CFG[flow.status]}`}>
                  {flow.status}
                </span>
                <span className="text-[10px] text-[#0A2540] truncate">{flow.name}</span>
                {flow.lastRun && (
                  <span className="text-[9px] text-muted-foreground ml-auto flex-shrink-0">
                    {new Date(flow.lastRun).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
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
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Documents</p>
          <div className="space-y-1">
            {docs.map((doc, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${APPROVAL_CFG[doc.approvalStatus]}`}>
                  {doc.approvalStatus === "approved" ? "✓" : doc.approvalStatus === "revision_requested" ? "↩" : "…"}
                </span>
                <span className="text-[10px] text-[#0A2540] truncate">{doc.name}</span>
                {doc.version && (
                  <span className="text-[9px] text-muted-foreground flex-shrink-0">v{doc.version}</span>
                )}
                {doc.downloadUrl && (
                  <a
                    href={doc.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-[9px] text-[#0078D4] hover:underline ml-auto flex-shrink-0"
                  >
                    ↓
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
        <ActionBtn label="Download All" />
        <ActionBtn label="Request Revision" />
        <ActionBtn label="Mark Approved" />
      </div>
    </div>
  );
}

function DiscoveryBody({ m }: { m: DiscoveryMetadata }) {
  const recs = m.recommendations ?? [];
  return (
    <div className="space-y-2">
      {m.riskScore && (
        <span className={`inline-flex items-center text-[9px] font-bold px-2 py-0.5 rounded-full ${RISK_CFG[m.riskScore]}`}>
          Risk: {m.riskScore}
        </span>
      )}
      {m.findingsSummary && (
        <p className="text-[10px] text-[#0A2540] leading-snug">{m.findingsSummary}</p>
      )}
      {recs.length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Recommendations</p>
          <div className="space-y-0.5">
            {recs.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-[9px] text-pink-500 flex-shrink-0 mt-0.5">→</span>
                <span className="text-[10px] text-[#0A2540]">{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
        <ActionBtn label="Convert to Project" />
        {m.assessmentUrl && (
          <ActionBtn label="Export Assessment" onClick={() => window.open(m.assessmentUrl, "_blank")} />
        )}
      </div>
    </div>
  );
}

function CollapsedSummary({
  taskType,
  metadata,
}: {
  taskType: string;
  metadata: Record<string, unknown> | null;
}) {
  if (!metadata) return null;
  if (taskType === "training") {
    const m = metadata as TrainingMetadata;
    const mods = m.modules ?? [];
    const done = mods.filter(x => x.completed).length;
    if (mods.length === 0) return null;
    return (
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {done}/{mods.length} modules complete
      </p>
    );
  }
  if (taskType === "environmentHealthCheck") {
    const m = metadata as HealthCheckMetadata;
    if (!m.healthStatus) return null;
    return (
      <span className={`inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 ${HEALTH_CFG[m.healthStatus]}`}>
        {m.healthStatus === "healthy" ? "✓ Healthy" : m.healthStatus === "warning" ? "⚠ Warning" : "✖ Critical"}
      </span>
    );
  }
  if (taskType === "automationBuild") {
    const m = metadata as AutomationMetadata;
    const flows = m.flows ?? [];
    const live = flows.filter(f => f.status === "live").length;
    if (flows.length === 0) return null;
    return (
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {live}/{flows.length} flows live
      </p>
    );
  }
  if (taskType === "documentDelivery") {
    const m = metadata as DocumentMetadata;
    const docs = m.documents ?? [];
    const approved = docs.filter(d => d.approvalStatus === "approved").length;
    if (docs.length === 0) return null;
    return (
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {approved}/{docs.length} docs approved
      </p>
    );
  }
  if (taskType === "discovery") {
    const m = metadata as DiscoveryMetadata;
    if (!m.riskScore) return null;
    return (
      <span className={`inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 ${RISK_CFG[m.riskScore]}`}>
        Risk: {m.riskScore}
      </span>
    );
  }
  return null;
}

export function TypedCardContent({
  taskType,
  metadata,
}: {
  taskType: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!taskType) return null;
  const cfg = TASK_TYPE_CONFIG[taskType as TaskType];
  if (!cfg) return null;

  const hasDetail = metadata && Object.keys(metadata).length > 0;

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <div className="flex items-center gap-1.5 justify-between mb-1">
        <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded ${cfg.badge}`}>
          {cfg.icon} {cfg.label}
        </span>
        {hasDetail && (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}
            className="text-[9px] font-semibold text-[#0078D4] hover:underline flex items-center gap-0.5"
          >
            {expanded ? "▲ Hide" : "▼ Details"}
          </button>
        )}
      </div>

      {!expanded && hasDetail && (
        <CollapsedSummary taskType={taskType} metadata={metadata} />
      )}

      {expanded && hasDetail && (
        <div className="mt-1.5 space-y-1">
          {taskType === "training" && <TrainingBody m={metadata as TrainingMetadata} />}
          {taskType === "environmentHealthCheck" && <HealthCheckBody m={metadata as HealthCheckMetadata} />}
          {taskType === "governanceSetup" && <GovernanceBody m={metadata as GovernanceMetadata} />}
          {taskType === "automationBuild" && <AutomationBody m={metadata as AutomationMetadata} />}
          {taskType === "documentDelivery" && <DocumentBody m={metadata as DocumentMetadata} />}
          {taskType === "discovery" && <DiscoveryBody m={metadata as DiscoveryMetadata} />}
        </div>
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
      {cfg.icon} {cfg.label}
    </span>
  );
}
