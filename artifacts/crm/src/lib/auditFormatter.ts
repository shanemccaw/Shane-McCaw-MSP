export interface AuditLogEntry {
  id: number;
  actorName: string;
  actorRole: string;
  actionType: string;
  entityType: string;
  entityLabel: string | null;
  clientId: number | null;
  projectId: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityItemMeta {
  icon: string;
  color: string;
  label: string;
  href: string | null;
}

export function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dateBucket(iso: string): "Today" | "Yesterday" | "Earlier" {
  const now = new Date();
  const then = new Date(iso);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  if (then >= todayStart) return "Today";
  if (then >= yesterdayStart) return "Yesterday";
  return "Earlier";
}

export function formatActivityItem(entry: AuditLogEntry): ActivityItemMeta {
  const { actionType, entityLabel, metadata, projectId } = entry;
  const label = entityLabel ?? "unknown";
  const meta = metadata ?? {};

  const ICON_TASK = "task";
  const ICON_INVOICE = "invoice";
  const ICON_SERVICE = "service";
  const ICON_PROJECT = "project";
  const ICON_REPORT = "report";
  const ICON_CONTRACT = "contract";
  const ICON_LEAD = "lead";
  const ICON_USER = "user";
  const ICON_DOCUMENT = "document";
  const ICON_DEFAULT = "default";

  const COLOR_BLUE = "text-[#0078D4] bg-[#0078D4]/10";
  const COLOR_GREEN = "text-emerald-600 bg-emerald-50";
  const COLOR_YELLOW = "text-amber-600 bg-amber-50";
  const COLOR_RED = "text-red-500 bg-red-50";
  const COLOR_PURPLE = "text-purple-600 bg-purple-50";
  const COLOR_TEAL = "text-teal-600 bg-teal-50";
  const COLOR_GRAY = "text-gray-500 bg-gray-100";

  switch (actionType) {
    case "kanban_task_created":
      return { icon: ICON_TASK, color: COLOR_BLUE, label: `Task created: '${label}'`, href: projectId ? `/portal/projects/${projectId}` : null };
    case "kanban_task_moved": {
      const to = String(meta.to ?? "").replace(/_/g, " ");
      return { icon: ICON_TASK, color: COLOR_BLUE, label: `Task '${label}' moved to ${to}`, href: projectId ? `/portal/projects/${projectId}` : null };
    }
    case "kanban_task_closed":
      return { icon: ICON_TASK, color: COLOR_GREEN, label: `Task '${label}' closed`, href: projectId ? `/portal/projects/${projectId}` : null };
    case "kanban_task_updated":
      return { icon: ICON_TASK, color: COLOR_BLUE, label: `Task '${label}' updated`, href: projectId ? `/portal/projects/${projectId}` : null };
    case "kanban_task_due_date_set":
      return { icon: ICON_TASK, color: COLOR_YELLOW, label: `Due date set on '${label}'`, href: projectId ? `/portal/projects/${projectId}` : null };
    case "invoice_created":
      return { icon: ICON_INVOICE, color: COLOR_BLUE, label: `Invoice #${label} created`, href: "/portal/billing" };
    case "invoice_paid": {
      const amount = meta.amountDollars ? ` ($${meta.amountDollars})` : "";
      return { icon: ICON_INVOICE, color: COLOR_GREEN, label: `Invoice #${label} paid${amount}`, href: "/portal/billing" };
    }
    case "invoice_status_changed": {
      const status = String(meta.status ?? "updated");
      return { icon: ICON_INVOICE, color: COLOR_YELLOW, label: `Invoice #${label} marked ${status}`, href: "/portal/billing" };
    }
    case "service_purchased": {
      const amount = meta.amount ? ` ($${meta.amount})` : "";
      return { icon: ICON_SERVICE, color: COLOR_GREEN, label: `Purchased ${label}${amount}`, href: "/portal/services" };
    }
    case "service_activated":
      return { icon: ICON_SERVICE, color: COLOR_GREEN, label: `Service '${label}' activated`, href: "/portal/services" };
    case "service_deactivated":
      return { icon: ICON_SERVICE, color: COLOR_YELLOW, label: `Service '${label}' deactivated`, href: "/portal/services" };
    case "retainer_cancelled":
      return { icon: ICON_SERVICE, color: COLOR_RED, label: `Retainer '${label}' cancelled`, href: "/portal/services" };
    case "retainer_resumed":
      return { icon: ICON_SERVICE, color: COLOR_GREEN, label: `Retainer '${label}' resumed`, href: "/portal/services" };
    case "contract_created":
      return { icon: ICON_CONTRACT, color: COLOR_PURPLE, label: "New contract created", href: null };
    case "contract_signed":
      return { icon: ICON_CONTRACT, color: COLOR_GREEN, label: `Contract '${label}' signed`, href: null };
    case "project_created":
      return { icon: ICON_PROJECT, color: COLOR_BLUE, label: `Project '${label}' started`, href: projectId ? `/portal/projects/${projectId}` : "/portal/projects" };
    case "project_closed":
      return { icon: ICON_PROJECT, color: COLOR_GREEN, label: `Project '${label}' closed`, href: projectId ? `/portal/projects/${projectId}` : "/portal/projects" };
    case "workflow_step_changed": {
      const to = String(meta.to ?? "unknown").replace(/_/g, " ");
      return { icon: ICON_PROJECT, color: COLOR_TEAL, label: `Workflow step '${label}' → ${to}`, href: projectId ? `/portal/projects/${projectId}` : null };
    }
    case "status_report_published": {
      const period = String(meta.period ?? "").replace(/_/g, " ");
      return { icon: ICON_REPORT, color: COLOR_BLUE, label: `${period || "Report"} published`, href: "/portal/reports" };
    }
    case "status_report_question":
      return { icon: ICON_REPORT, color: COLOR_YELLOW, label: `Question on report '${String(meta.reportTitle ?? label)}'`, href: "/portal/reports" };
    case "status_report_reply":
      return { icon: ICON_REPORT, color: COLOR_TEAL, label: `Reply on report '${String(meta.reportTitle ?? label)}'`, href: "/portal/reports" };
    case "status_report_resolved":
      return { icon: ICON_REPORT, color: COLOR_GREEN, label: `Question resolved on report '${String(meta.reportTitle ?? label)}'`, href: "/portal/reports" };
    case "lead_created":
      return { icon: ICON_LEAD, color: COLOR_PURPLE, label: `New lead '${label}' submitted`, href: null };
    case "lead_status_changed": {
      const to = String(meta.to ?? "");
      return { icon: ICON_LEAD, color: COLOR_YELLOW, label: `Lead '${label}' moved to ${to}`, href: null };
    }
    case "client_created":
      return { icon: ICON_USER, color: COLOR_GREEN, label: `Account created for ${label}`, href: null };
    case "client_onboarding_completed":
      return { icon: ICON_USER, color: COLOR_GREEN, label: "Onboarding completed", href: null };
    case "admin_impersonated":
      return { icon: ICON_USER, color: COLOR_GRAY, label: `Portal previewed as ${label}`, href: null };
    case "document_uploaded":
      return { icon: ICON_DOCUMENT, color: COLOR_BLUE, label: `Document uploaded: '${label}'`, href: null };
    case "automation_run_started": {
      const pkg = meta.packageTitle ? `"${String(meta.packageTitle)}"` : "automation";
      return { icon: "service", color: COLOR_BLUE, label: `${pkg} scan started`, href: null };
    }
    case "automation_run_completed": {
      const pkg = meta.packageTitle ? `"${String(meta.packageTitle)}"` : "Automation";
      const steps = meta.modulesTotal ? ` (${String(meta.modulesCompleted)} of ${String(meta.modulesTotal)} steps)` : "";
      return { icon: "service", color: COLOR_GREEN, label: `${pkg} scan completed${steps}`, href: null };
    }
    case "automation_run_failed": {
      const pkg = meta.packageTitle ? `"${String(meta.packageTitle)}"` : "Automation";
      return { icon: "service", color: COLOR_RED, label: `${pkg} scan encountered an issue`, href: null };
    }
    case "health_score_updated":
      return { icon: ICON_REPORT, color: COLOR_TEAL, label: `M365 health scores updated`, href: "/portal/health" };
    default:
      return { icon: ICON_DEFAULT, color: COLOR_GRAY, label: actionType.replace(/_/g, " "), href: null };
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatAuditEntry(entry: AuditLogEntry): string {
  const { actorName, actionType, entityLabel, metadata, createdAt } = entry;
  const date = `On ${fmtDate(createdAt)}`;
  const label = entityLabel ?? "unknown";
  const meta = metadata ?? {};

  switch (actionType) {
    case "kanban_task_created":
      return `${date} ${actorName} created task '${label}'`;
    case "kanban_task_moved": {
      const from = String(meta.from ?? "").replace(/_/g, " ");
      const to = String(meta.to ?? "").replace(/_/g, " ");
      return `${date} ${actorName} moved task '${label}' from ${from} to ${to}`;
    }
    case "kanban_task_closed": {
      const notes = meta.notes ? ` with comment '${meta.notes}'` : "";
      return `${date} ${actorName} closed task '${label}'${notes}`;
    }
    case "kanban_task_updated":
      return `${date} ${actorName} updated task '${label}'`;
    case "kanban_task_due_date_set": {
      const due = meta.to ? ` to ${String(meta.to)}` : "";
      return `${date} ${actorName} set due date on task '${label}'${due}`;
    }
    case "invoice_created": {
      const client = meta.clientName ? ` for ${meta.clientName}` : "";
      return `${date} ${actorName} created invoice #${label}${client}`;
    }
    case "invoice_paid": {
      const amount = meta.amountDollars ? ` ($${meta.amountDollars})` : "";
      return `${date} ${actorName} paid invoice #${label}${amount}`;
    }
    case "invoice_status_changed": {
      const status = String(meta.status ?? "unknown");
      return `${date} ${actorName} marked invoice #${label} as ${status}`;
    }
    case "service_purchased": {
      const amount = meta.amount ? ` ($${meta.amount})` : "";
      return `${date} ${actorName} purchased ${label}${amount}`;
    }
    case "service_activated":
      return `${date} ${actorName} activated service '${label}'`;
    case "service_deactivated":
      return `${date} ${actorName} deactivated service '${label}'`;
    case "retainer_cancelled":
      return `${date} ${actorName} cancelled retainer '${label}'`;
    case "retainer_resumed":
      return `${date} ${actorName} resumed retainer '${label}'`;
    case "contract_created": {
      const client = meta.clientName ? ` for ${meta.clientName}` : "";
      return `${date} ${actorName} created contract${client}`;
    }
    case "contract_signed":
      return `${date} ${actorName} signed contract '${label}'`;
    case "project_created": {
      const client = meta.clientName ? ` for ${meta.clientName}` : "";
      return `${date} ${actorName} created project '${label}'${client}`;
    }
    case "project_closed":
      return `${date} ${actorName} closed project '${label}'`;
    case "workflow_step_changed": {
      const to = String(meta.to ?? "unknown").replace(/_/g, " ");
      const from = meta.from ? ` from ${String(meta.from).replace(/_/g, " ")}` : "";
      return `${date} ${actorName} moved workflow step '${label}'${from} to ${to}`;
    }
    case "status_report_published": {
      const period = String(meta.period ?? "").replace(/_/g, " ");
      const client = meta.clientName ? ` for ${meta.clientName}` : "";
      return `${date} ${actorName} published a ${period} report${client}`;
    }
    case "status_report_question": {
      const report = String(meta.reportTitle ?? label);
      return `${date} ${actorName} asked a question on report '${report}'`;
    }
    case "status_report_reply": {
      const client = String(meta.clientName ?? actorName);
      const report = String(meta.reportTitle ?? label);
      return `${date} ${actorName} replied to ${client}'s question on report '${report}'`;
    }
    case "status_report_resolved": {
      const report = String(meta.reportTitle ?? label);
      return `${date} ${actorName} marked a question resolved on report '${report}'`;
    }
    case "lead_created": {
      const source = String(meta.source ?? "unknown").replace(/_/g, " ");
      return `${date} New lead '${label}' submitted via ${source}`;
    }
    case "lead_status_changed": {
      const from = String(meta.from ?? "");
      const to = String(meta.to ?? "");
      return `${date} ${actorName} moved lead '${label}' from ${from} to ${to}`;
    }
    case "client_created":
      return `${date} ${actorName} created client account for ${label}`;
    case "client_onboarding_completed":
      return `${date} ${actorName} completed onboarding`;
    case "admin_impersonated":
      return `${date} ${actorName} previewed portal as ${label}`;
    case "document_uploaded": {
      const client = meta.clientName ? ` for ${meta.clientName}` : "";
      return `${date} ${actorName} uploaded '${label}'${client}`;
    }
    case "automation_run_started": {
      const pkg = meta.packageTitle ? ` "${String(meta.packageTitle)}"` : "";
      return `${date} Automation${pkg} scan started`;
    }
    case "automation_run_completed": {
      const pkg = meta.packageTitle ? ` "${String(meta.packageTitle)}"` : "";
      const steps = meta.modulesTotal ? ` (${String(meta.modulesCompleted)}/${String(meta.modulesTotal)} steps)` : "";
      return `${date} Automation${pkg} scan completed${steps}`;
    }
    case "automation_run_failed": {
      const pkg = meta.packageTitle ? ` "${String(meta.packageTitle)}"` : "";
      return `${date} Automation${pkg} scan encountered an issue`;
    }
    case "health_score_updated":
      return `${date} M365 health scores updated`;
    default:
      return `${date} ${actorName} performed ${actionType.replace(/_/g, " ")} on ${label}`;
  }
}

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  kanban_task: "Tasks",
  invoice: "Invoices",
  contract: "Contracts",
  service: "Services",
  project: "Projects",
  workflow_step: "Workflow Steps",
  status_report: "Status Reports",
  lead: "Leads",
  user: "Clients & Accounts",
  document: "Documents",
};
