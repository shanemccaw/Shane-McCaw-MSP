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
    case "credential_verification_passed":
      return `${date} ${actorName} verified Azure credentials for ${label} — passed`;
    case "credential_verification_failed": {
      const errMsg = meta.errorMessage ? ` (${String(meta.errorMessage).slice(0, 120)})` : "";
      return `${date} ${actorName} attempted Azure credential verification for ${label} — failed${errMsg}`;
    }
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
  app_registration: "Credential Verifications",
};
