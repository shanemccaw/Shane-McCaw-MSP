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
  vulnerabilityScore?: number;
  criticalAlerts?: Array<{ title: string; description: string; severity?: "critical" | "warning" }>;
  activityLog?: Array<{ event: string; timestamp: string; detail?: string; type?: "primary" | "error" | "neutral" }>;
  assignedToRole?: string;
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
          {taskType === "training" && <TrainingBody m={metadata as TrainingMetadata} />}
          {taskType === "environmentHealthCheck" && <HealthCheckBody m={metadata as HealthCheckMetadata} />}
          {taskType === "governanceSetup" && <GovernanceBody m={metadata as GovernanceMetadata} />}
          {taskType === "automationBuild" && <AutomationBody m={metadata as AutomationMetadata} />}
          {taskType === "documentDelivery" && (
            <DocumentBody m={metadata as DocumentMetadata} onMarkApproved={onMarkDocumentApproved} />
          )}
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
      <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}
