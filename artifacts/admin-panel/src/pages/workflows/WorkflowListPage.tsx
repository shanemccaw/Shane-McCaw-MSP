import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { format } from "date-fns";

// ── Ask-for-Input types & constants ──────────────────────────────────────────

type AskForInputFieldType =
  | "text" | "number" | "select" | "textarea"
  | "customer" | "project" | "lead" | "opportunity" | "document_type";

const ENTITY_FIELD_TYPES: AskForInputFieldType[] = ["customer", "project", "lead", "opportunity", "document_type"];

const DOCUMENT_TYPE_GROUPS: { group: string; items: { id: string; label: string }[] }[] = [
  {
    group: "Reports",
    items: [
      { id: "executive_summary",           label: "Executive Summary" },
      { id: "full_readiness_report",       label: "Full Readiness Report" },
      { id: "security_posture_report",     label: "Security Posture Report" },
      { id: "governance_maturity_report",  label: "Governance Maturity Report" },
      { id: "data_exposure_risk_report",   label: "Data Exposure Risk Report" },
      { id: "license_optimization_report", label: "License Optimization Report" },
    ],
  },
  {
    group: "Consulting Documents",
    items: [
      { id: "consolidated_sow",            label: "Consolidated SOW" },
      { id: "sow",                         label: "Statement of Work" },
      { id: "task_execution_guide",        label: "SOW Task Execution Guide" },
      { id: "remediation_plan",            label: "Remediation Plan" },
      { id: "deployment_plan",             label: "Deployment Plan" },
      { id: "governance_framework",        label: "Governance Framework" },
      { id: "security_hardening_plan",     label: "Security Hardening Plan" },
      { id: "copilot_enablement_plan",     label: "Copilot Enablement Plan" },
      { id: "identity_modernization_plan", label: "Identity Modernization Plan" },
      { id: "copilot_readiness",           label: "Copilot Readiness Assessment" },
    ],
  },
];

const PROJECT_TYPE_LABELS: Record<string, string> = {
  project:   "Project",
  retainer:  "Retainer",
  quick_win: "Quick Win",
};

interface EntityOption { id: string; label: string; group?: string }

interface AskForInputField {
  variableName: string;
  label: string;
  type: AskForInputFieldType;
  required?: boolean;
  options?: string;
  multi?: boolean;
}

// ── Entity options hook ───────────────────────────────────────────────────────

function useEntityOptions(
  type: AskForInputFieldType,
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>,
  siblingValues: Record<string, string | string[]> = {},
  siblingFields: AskForInputField[] = [],
): { options: EntityOption[]; loading: boolean } {
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [loading, setLoading] = useState(false);

  const selectedCustomerId = type === "project"
    ? (() => {
        const cf = siblingFields.find(f => f.type === "customer");
        if (!cf) return "";
        const raw = siblingValues[cf.variableName];
        return Array.isArray(raw) ? (raw[0] ?? "") : (raw || "");
      })()
    : "";

  useEffect(() => {
    if (!ENTITY_FIELD_TYPES.includes(type)) return;
    if (type === "document_type") {
      const flat: EntityOption[] = [];
      for (const g of DOCUMENT_TYPE_GROUPS) {
        for (const item of g.items) flat.push({ id: item.id, label: item.label, group: g.group });
      }
      setOptions(flat);
      return;
    }
    setLoading(true);
    let url: string;
    if (type === "project") {
      const params = new URLSearchParams({ limit: "100" });
      if (selectedCustomerId) params.set("customerId", selectedCustomerId);
      url = `/api/admin/insights/projects?${params.toString()}`;
    } else {
      const urlMap: Record<string, string> = {
        customer:    "/api/admin/clients/enriched",
        lead:        "/api/leads?limit=100",
        opportunity: "/api/opportunities?limit=100",
      };
      url = urlMap[type] ?? "";
    }
    fetchWithAuth(url)
      .then(r => r.json())
      .then((data: unknown) => {
        let rows: unknown[];
        if (type === "project" && data && typeof data === "object" && "projects" in (data as object)) {
          rows = ((data as { projects: unknown[] }).projects) ?? [];
        } else {
          rows = Array.isArray(data) ? data : ((data as { data?: unknown[] }).data ?? []);
        }
        const mapped = (rows as Record<string, unknown>[]).map(r => {
          const id = String(r.id ?? "");
          let label = "";
          if (type === "customer") {
            label = String(r.name || r.email || id) + (r.company ? ` (${String(r.company)})` : "");
          } else if (type === "project") {
            const typeTag = r.projectType ? ` · ${PROJECT_TYPE_LABELS[String(r.projectType)] ?? String(r.projectType)}` : "";
            const status = r.status && r.status !== "active" ? ` [${String(r.status)}]` : "";
            label = String(r.title || r.name || id) + typeTag + status;
          } else if (type === "lead") {
            label = String(r.name || r.email || id);
          } else if (type === "opportunity") {
            label = String(r.companyName || r.contactName || r.name || id);
          }
          return { id, label };
        }).filter(o => o.id);
        setOptions(mapped);
      })
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  }, [type, selectedCustomerId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { options, loading };
}

// ── EntityPickerControl ───────────────────────────────────────────────────────

function EntityPickerControl({
  field, value, onChange, fetchWithAuth, hasError, siblingValues, siblingFields,
}: {
  field: AskForInputField;
  value: string | string[];
  onChange: (v: string | string[]) => void;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
  hasError: boolean;
  siblingValues?: Record<string, string | string[]>;
  siblingFields?: AskForInputField[];
}) {
  const { options, loading } = useEntityOptions(field.type, fetchWithAuth, siblingValues, siblingFields);
  const [search, setSearch] = useState("");
  const selected = Array.isArray(value) ? value : (value ? value.split(",").filter(Boolean) : []);
  const filtered = options.filter(o => !search || o.label.toLowerCase().includes(search.toLowerCase()) || o.id.includes(search));
  const borderCls = hasError ? "border-red-500" : "border-[#30363D]";

  function renderWithGroups(renderItem: (o: EntityOption) => React.ReactNode) {
    const nodes: React.ReactNode[] = [];
    let lastGroup: string | undefined = undefined;
    for (const o of filtered) {
      if (o.group && o.group !== lastGroup) {
        nodes.push(
          <div key={`grp-${o.group}`} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#484F58] bg-[#161B22] border-b border-[#30363D] sticky top-0">
            {o.group}
          </div>,
        );
        lastGroup = o.group;
      }
      nodes.push(renderItem(o));
    }
    return nodes;
  }

  if (field.multi) {
    const toggle = (id: string) => {
      const next = selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id];
      onChange(next);
    };
    return (
      <div className={`border ${borderCls} rounded-lg bg-[#0D1117] overflow-hidden`}>
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#30363D]">
          <span className="text-[#484F58] text-xs">🔍</span>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="flex-1 bg-transparent text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none" />
          {selected.length > 0 && <span className="text-[10px] text-[#F97316] font-medium">{selected.length} selected</span>}
        </div>
        <div className="max-h-44 overflow-y-auto">
          {loading && <p className="text-[10px] text-[#484F58] p-3 text-center">Loading…</p>}
          {!loading && filtered.length === 0 && <p className="text-[10px] text-[#484F58] p-3 text-center">No results</p>}
          {!loading && renderWithGroups(o => (
            <label key={o.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#1C2128] cursor-pointer transition-colors">
              <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} className="w-3.5 h-3.5 rounded accent-orange-500 flex-shrink-0" />
              <span className="text-sm text-[#E6EDF3] truncate">{o.label}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`border ${borderCls} rounded-lg bg-[#0D1117] overflow-hidden`}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#30363D]">
        <span className="text-[#484F58] text-xs">🔍</span>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="flex-1 bg-transparent text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none" />
        {value && <span className="text-[10px] text-[#F97316] truncate max-w-[100px]">{options.find(o => o.id === value)?.label ?? String(value)}</span>}
      </div>
      <div className="max-h-44 overflow-y-auto">
        {loading && <p className="text-[10px] text-[#484F58] p-3 text-center">Loading…</p>}
        {!loading && filtered.length === 0 && <p className="text-[10px] text-[#484F58] p-3 text-center">No results</p>}
        {!loading && renderWithGroups(o => (
          <button key={o.id} type="button" onClick={() => { onChange(o.id); setSearch(""); }}
            className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[#1C2128] ${String(value) === o.id ? "text-[#F97316] bg-[#F97316]/10" : "text-[#E6EDF3]"}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── SmartRunInputModal ────────────────────────────────────────────────────────

function SmartRunInputModal({
  fields, onSubmit, onCancel, fetchWithAuth,
}: {
  fields: AskForInputField[];
  onSubmit: (values: Record<string, string | string[]>) => void;
  onCancel: () => void;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const [values, setValues] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries(fields.map(f => [f.variableName, f.multi ? [] : ""])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setValue(name: string, val: string | string[]) {
    setValues(v => ({ ...v, [name]: val }));
    setErrors(err => { const n = { ...err }; delete n[name]; return n; });
  }

  function handleSubmit() {
    const errs: Record<string, string> = {};
    for (const f of fields) {
      if (f.required) {
        const v = values[f.variableName];
        const empty = Array.isArray(v) ? v.length === 0 : !v?.toString().trim();
        if (empty) errs[f.variableName] = "Required";
      }
    }
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    onSubmit(values);
  }

  const inputCls = (name: string) =>
    `w-full bg-[#0D1117] border rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none transition-colors ${errors[name] ? "border-red-500 focus:border-red-400" : "border-[#30363D] focus:border-[#0078D4]/60"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[#30363D]">
          <span className="text-[#0078D4]">▶</span>
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Run inputs required</h3>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <p className="text-xs text-[#7D8590]">This workflow needs a few values before it can start.</p>

          {fields.map(f => (
            <div key={f.variableName} className="space-y-1.5">
              <label className="text-xs font-medium text-[#E6EDF3]">
                {f.label || f.variableName}
                {f.required && <span className="text-red-400 ml-0.5">*</span>}
                {ENTITY_FIELD_TYPES.includes(f.type) && (
                  <span className="ml-1.5 text-[10px] text-[#484F58] font-normal capitalize">
                    ({f.type.replace("_", " ")}{f.multi ? " · multi" : ""})
                  </span>
                )}
              </label>

              {ENTITY_FIELD_TYPES.includes(f.type) ? (
                <EntityPickerControl
                  field={f}
                  value={values[f.variableName] ?? ""}
                  onChange={v => setValue(f.variableName, v)}
                  fetchWithAuth={fetchWithAuth}
                  hasError={!!errors[f.variableName]}
                  siblingValues={values}
                  siblingFields={fields}
                />
              ) : f.type === "textarea" ? (
                <textarea
                  rows={3}
                  value={String(values[f.variableName] ?? "")}
                  onChange={e => setValue(f.variableName, e.target.value)}
                  className={inputCls(f.variableName) + " resize-none"}
                  placeholder={f.label || f.variableName}
                />
              ) : f.type === "select" ? (
                <select
                  value={String(values[f.variableName] ?? "")}
                  onChange={e => setValue(f.variableName, e.target.value)}
                  className={inputCls(f.variableName)}
                >
                  <option value="">— select —</option>
                  {(f.options ?? "").split(",").map(o => o.trim()).filter(Boolean).map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === "number" ? "number" : "text"}
                  value={String(values[f.variableName] ?? "")}
                  onChange={e => setValue(f.variableName, e.target.value)}
                  placeholder={f.label || f.variableName}
                  className={inputCls(f.variableName)}
                />
              )}

              {errors[f.variableName] && (
                <p className="text-[10px] text-red-400">{errors[f.variableName]}</p>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-[#30363D]">
          <button onClick={onCancel} className="text-xs text-[#7D8590] hover:text-[#E6EDF3] transition-colors">Cancel</button>
          <button
            onClick={handleSubmit}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#0078D4] hover:bg-[#006CBD] text-white text-xs font-medium rounded-lg transition-colors"
          >
            ▶ Run workflow
          </button>
        </div>
      </div>
    </div>
  );
}

interface WfDefinition {
  id: number;
  name: string;
  description: string | null;
  concurrencyLimit: number;
  publishedVersionLabel: string | null;
  publishedVersionNumber: number | null;
  triggerCount: number;
  triggerTypes: string[];
  triggerEventNames: string[];
  lastRunStatus: string | null;
  lastRunAt: string | null;
  createdAt: string;
  metadata?: { system?: boolean };
  askForInputFields: AskForInputField[] | null;
}

type TriggerCategory = "CRM" | "Payments" | "Scheduling" | "M365";

const CATEGORY_STYLES: Record<TriggerCategory, string> = {
  CRM:        "bg-blue-500/15 text-blue-300 border-blue-500/25",
  Payments:   "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  Scheduling: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  M365:       "bg-violet-500/15 text-violet-300 border-violet-500/25",
};

const EVENT_CATEGORY_MAP: Record<string, TriggerCategory> = {
  "lead.created":                    "CRM",
  "lead.qualified":                  "CRM",
  "opportunity.created":             "CRM",
  "client.created":                  "CRM",
  "project.created":                 "CRM",
  "project.phase_changed":           "CRM",
  "onboarding.complete":             "CRM",
  "sow.scope_reduced":               "CRM",
  "contract.signed":                 "CRM",
  "payment.received":                "Payments",
  "agreement_signed":                "Payments",
  "phase_completed":                 "Payments",
  "phase.delivery_date_changed":     "Scheduling",
  "milestone.delivery_date_changed": "Scheduling",
  "m365.health_check_complete":      "M365",
  "m365.diagnostic_failed":          "M365",
  "quiz.lead_submitted":             "M365",
  "customer.script_result":          "M365",
};

function deriveTriggerCategories(eventNames: string[]): TriggerCategory[] {
  const cats = new Set<TriggerCategory>();

  for (const ev of eventNames) {
    const mapped = EVENT_CATEGORY_MAP[ev];
    if (mapped) {
      cats.add(mapped);
    } else {
      const e = ev.toLowerCase();
      if (/^(client|lead|opportunity|kanban|crm)\./.test(e)) cats.add("CRM");
      else if (/^(payment|stripe|invoice|checkout|order)\./.test(e)) cats.add("Payments");
      else if (/^(booking|appointment|calendar|scheduling)\./.test(e)) cats.add("Scheduling");
      else if (/^(m365|copilot|sharepoint|teams)/.test(e)) cats.add("M365");
    }
  }

  return [...cats];
}

function CategoryPill({ category }: { category: TriggerCategory }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border flex-shrink-0 ${CATEGORY_STYLES[category]}`}>
      {category}
    </span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  running:   "bg-blue-500/20 text-blue-400 border-blue-500/30",
  failed:    "bg-red-500/20 text-red-400 border-red-500/30",
  pending:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
  cancelled: "bg-[#30363D] text-[#7D8590] border-[#30363D]",
};

function StatusChip({ status }: { status: string | null }) {
  if (!status) return <span className="text-[#484F58] text-xs">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_COLORS[status] ?? "bg-[#1C2128] text-[#7D8590] border-[#30363D]"}`}>
      {status}
    </span>
  );
}

function WorkflowCard({
  def,
  isSystem,
  onDelete,
  navigate,
  prodDbConnected,
  onPublishToProd,
  onRun,
  isRunning,
  isActiveRun,
  onStop,
}: {
  def: WfDefinition;
  isSystem: boolean;
  onDelete: (id: number) => void;
  navigate: (path: string) => void;
  prodDbConnected: boolean;
  onPublishToProd: (id: number) => void;
  onRun: (id: number) => void;
  isRunning: boolean;
  isActiveRun: boolean;
  onStop: () => void;
}) {
  const canRun = def.triggerTypes.includes("manual") || def.triggerTypes.includes("schedule");

  return (
    <div className="bg-[#161B22] border border-[#30363D] hover:border-[#0078D4]/40 rounded-xl p-4 flex items-center gap-4 group transition-colors">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${isSystem ? "bg-violet-500/5 border-violet-500/20" : "bg-[#0078D4]/10 border-[#0078D4]/20"}`}>
        {isSystem ? (
          <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-[#0078D4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-[#E6EDF3] truncate">{def.name}</span>
          {deriveTriggerCategories(def.triggerEventNames ?? []).map(cat => (
            <CategoryPill key={cat} category={cat} />
          ))}
          {def.publishedVersionLabel && (
            <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
              {def.publishedVersionLabel}
            </span>
          )}
        </div>
        {def.description && (
          <p className="text-xs text-[#7D8590] truncate mt-0.5">{def.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-xs text-[#484F58]">
          <span>{def.triggerCount} trigger{def.triggerCount !== 1 ? "s" : ""}</span>
          <span>·</span>
          <span>max {def.concurrencyLimit} concurrent</span>
          {def.lastRunAt && (
            <>
              <span>·</span>
              <span>last run {format(new Date(def.lastRunAt), "MMM d")}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <StatusChip status={def.lastRunStatus} />

        {/* Play / Stop button — only for manual/schedule workflows */}
        {canRun && (
          <button
            onClick={() => isActiveRun ? onStop() : onRun(def.id)}
            disabled={isRunning}
            title={isActiveRun ? "Stop run" : "Run now"}
            className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isActiveRun
                ? "text-red-400 hover:text-red-300 hover:bg-red-500/10"
                : "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
            }`}
          >
            {isRunning ? (
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : isActiveRun ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        )}

        <button
          onClick={() => navigate(`/workflows/runs?definitionId=${def.id}`)}
          className="p-1.5 text-[#484F58] hover:text-[#7D8590] rounded-lg hover:bg-[#1C2128] transition-colors"
          title="Run history"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </button>

        <button
          onClick={() => navigate(`/workflows/triggers/${def.id}`)}
          className="p-1.5 text-[#484F58] hover:text-[#7D8590] rounded-lg hover:bg-[#1C2128] transition-colors"
          title="Triggers"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </button>

        <button
          onClick={() => navigate(`/workflows/builder/${def.id}`)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0078D4]/10 hover:bg-[#0078D4]/20 text-[#0078D4] text-xs font-medium rounded-lg border border-[#0078D4]/20 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          Open Builder
        </button>

        <button
          onClick={() => onPublishToProd(def.id)}
          disabled={!prodDbConnected || def.publishedVersionNumber === null}
          title={
            !prodDbConnected
              ? "Production database not configured — set DATABASE_URL_PROD in Replit Secrets"
              : def.publishedVersionNumber === null
              ? "Publish a version first — no published version exists for this workflow"
              : "Publish this workflow to the production database"
          }
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium rounded-lg border border-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Publish to Prod
        </button>

        {isSystem ? (
          <span
            className="p-1.5 text-[#30363D] rounded-lg cursor-not-allowed"
            title="System workflows cannot be deleted"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </span>
        ) : (
          <button
            onClick={() => onDelete(def.id)}
            className="p-1.5 text-[#484F58] hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export default function WorkflowListPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [systemExpanded, setSystemExpanded] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [activeRun, setActiveRun] = useState<{ defId: number; runId: number } | null>(null);
  const [inputDialog, setInputDialog] = useState<{ defId: number; fields: AskForInputField[] } | null>(null);

  const { data: defs = [], isLoading } = useQuery<WfDefinition[]>({
    queryKey: ["wf-definitions"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/workflows/definitions");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const userDefs = defs.filter(d => !d.metadata?.system);
  const systemDefs = defs.filter(d => d.metadata?.system);

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/workflows/definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json() as Promise<{ id: number; draftVersionId: number }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["wf-definitions"] });
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      navigate(`/workflows/builder/${data.id}?vid=${data.draftVersionId}`);
    },
  });

  const { data: prodDbStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["prod-db-status"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/prod-db/status");
      if (!res.ok) return { connected: false };
      return res.json();
    },
    staleTime: 60_000,
  });
  const prodDbConnected = prodDbStatus?.connected ?? false;

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wf-definitions"] });
      setDeleteId(null);
    },
  });

  const publishToProdMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${id}/publish-to-prod`, { method: "POST" });
      const body = await res.json() as { ok?: boolean; name?: string; publishedVersionId?: number | null; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to publish to production");
      return body;
    },
    onSuccess: (data) => {
      if (data.publishedVersionId == null) {
        toast({
          title: "No version published",
          description: `"${data.name ?? "Workflow"}" was synced but has no published version — open the builder and publish a version first.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Published to production", description: `"${data.name ?? "Workflow"}" is now in the production database.` });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Publish failed", description: err.message, variant: "destructive" });
    },
  });

  const runMut = useMutation({
    mutationFn: async ({ id, iv }: { id: number; iv?: Record<string, string | string[]> }) => {
      setRunningId(id);
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputValues: iv ?? {} }),
      });
      const body = await res.json() as { runId?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to start run");
      return { runId: body.runId!, defId: id };
    },
    onSuccess: (data) => {
      setRunningId(null);
      setActiveRun({ defId: data.defId, runId: data.runId });
      qc.invalidateQueries({ queryKey: ["wf-definitions"] });
      toast({
        title: "Run started",
        description: (
          <span>
            Workflow is running.{" "}
            <button
              className="underline font-medium"
              onClick={() => navigate(`/workflows/runs?definitionId=${data.defId}`)}
            >
              View run
            </button>
          </span>
        ) as unknown as string,
      });
    },
    onError: (err: Error) => {
      setRunningId(null);
      toast({ title: "Run failed", description: err.message, variant: "destructive" });
    },
  });

  const stopMut = useMutation({
    mutationFn: async (runId: number) => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs/${runId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to stop run");
    },
    onSuccess: () => {
      setActiveRun(null);
      qc.invalidateQueries({ queryKey: ["wf-definitions"] });
      toast({ title: "Run stopped" });
    },
    onError: (err: Error) => {
      toast({ title: "Stop failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: activeRunStatus } = useQuery<string>({
    queryKey: ["wf-run-status-list", activeRun?.runId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs/${activeRun!.runId}`);
      if (!res.ok) return "completed";
      const d = await res.json() as { status: string };
      return d.status;
    },
    enabled: activeRun !== null,
    refetchInterval: (q) => {
      const s = q.state.data;
      return s === "pending" || s === "running" ? 2000 : false;
    },
  });

  useEffect(() => {
    if (!activeRun) return undefined;
    if (activeRunStatus && activeRunStatus !== "pending" && activeRunStatus !== "running") {
      const t = setTimeout(() => {
        setActiveRun(null);
        void qc.invalidateQueries({ queryKey: ["wf-definitions"] });
      }, 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [activeRun, activeRunStatus, qc]);

  function handlePlayClick(def: WfDefinition) {
    const fields = def.askForInputFields;
    if (fields && fields.length > 0) {
      setInputDialog({ defId: def.id, fields });
    } else {
      runMut.mutate({ id: def.id });
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#E6EDF3]">Workflows</h1>
            <p className="text-sm text-[#7D8590] mt-0.5">
              Design, version, and run automated workflows.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#006CBD] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Workflow
          </button>
        </div>

        {/* Create dialog */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
            <div className="bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
              <h2 className="font-semibold text-[#E6EDF3]">New Workflow</h2>
              <div className="space-y-3">
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Workflow name"
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
                  autoFocus
                />
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder="Description (optional)"
                  rows={2}
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-[#7D8590] hover:text-[#E6EDF3] transition-colors">Cancel</button>
                <button
                  onClick={() => createMut.mutate()}
                  disabled={!newName.trim() || createMut.isPending}
                  className="px-4 py-2 bg-[#0078D4] hover:bg-[#006CBD] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {createMut.isPending ? "Creating…" : "Create & Open Builder"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirm */}
        {deleteId !== null && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setDeleteId(null)}>
            <div className="bg-[#161B22] border border-red-500/30 rounded-xl p-6 max-w-sm w-full space-y-4" onClick={e => e.stopPropagation()}>
              <h2 className="font-semibold text-[#E6EDF3]">Delete Workflow</h2>
              <p className="text-sm text-[#7D8590]">This will permanently delete the workflow and all its versions, triggers, and run history.</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm text-[#7D8590] hover:text-[#E6EDF3] transition-colors">Cancel</button>
                <button
                  onClick={() => deleteMut.mutate(deleteId)}
                  disabled={deleteMut.isPending}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {deleteMut.isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-[#161B22] border border-[#30363D] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">

            {/* User workflows */}
            {userDefs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-16 h-16 bg-[#1C2128] border border-[#30363D] rounded-2xl flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-[#484F58]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                </div>
                <p className="text-[#E6EDF3] font-medium">No workflows yet</p>
                <p className="text-sm text-[#7D8590] mt-1">Create your first workflow to get started.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {userDefs.map(def => (
                  <WorkflowCard
                    key={def.id}
                    def={def}
                    isSystem={false}
                    onDelete={setDeleteId}
                    navigate={navigate}
                    prodDbConnected={prodDbConnected}
                    onPublishToProd={id => publishToProdMut.mutate(id)}
                    onRun={id => handlePlayClick(defs.find(d => d.id === id)!)}
                    isRunning={runningId === def.id}
                    isActiveRun={activeRun?.defId === def.id}
                    onStop={() => activeRun && stopMut.mutate(activeRun.runId)}
                  />
                ))}
              </div>
            )}

            {/* System workflows — collapsible, collapsed by default */}
            {systemDefs.length > 0 && (
              <div>
                <button
                  onClick={() => setSystemExpanded(v => !v)}
                  className="flex items-center gap-2 w-full text-left group mb-2"
                >
                  <span className="flex-1 h-px bg-[#21262D]" />
                  <span className="flex items-center gap-1.5 text-xs text-[#484F58] group-hover:text-[#7D8590] transition-colors px-1 select-none">
                    <svg
                      className={`w-3 h-3 transition-transform ${systemExpanded ? "rotate-90" : ""}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    System workflows
                    <span className="bg-[#1C2128] border border-[#30363D] rounded-full px-1.5 py-px text-[10px] font-medium">
                      {systemDefs.length}
                    </span>
                  </span>
                  <span className="flex-1 h-px bg-[#21262D]" />
                </button>

                {systemExpanded && (
                  <div className="space-y-2">
                    {systemDefs.map(def => (
                      <WorkflowCard
                        key={def.id}
                        def={def}
                        isSystem={true}
                        onDelete={setDeleteId}
                        navigate={navigate}
                        prodDbConnected={prodDbConnected}
                        onPublishToProd={id => publishToProdMut.mutate(id)}
                        onRun={id => handlePlayClick(defs.find(d => d.id === id)!)}
                        isRunning={runningId === def.id}
                        isActiveRun={activeRun?.defId === def.id}
                        onStop={() => activeRun && stopMut.mutate(activeRun.runId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        )}
      </div>

      {/* Smart Ask-for-Input dialog */}
      {inputDialog && (
        <SmartRunInputModal
          fields={inputDialog.fields}
          fetchWithAuth={fetchWithAuth}
          onCancel={() => setInputDialog(null)}
          onSubmit={values => {
            const id = inputDialog.defId;
            setInputDialog(null);
            runMut.mutate({ id, iv: values });
          }}
        />
      )}
    </div>
  );
}
