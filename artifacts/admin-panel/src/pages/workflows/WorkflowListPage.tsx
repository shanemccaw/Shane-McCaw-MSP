import { useState, useEffect, useRef, useCallback } from "react";
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

// ── Types ─────────────────────────────────────────────────────────────────────

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
  metadata?: { system?: boolean; category?: string };
  askForInputFields: AskForInputField[] | null;
}

interface WfRun {
  id: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  durationMs?: number | null;
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

const STATUS_DOT_COLORS: Record<string, string> = {
  running:   "bg-blue-400 animate-pulse",
  pending:   "bg-amber-400 animate-pulse",
  completed: "bg-emerald-500",
  failed:    "bg-red-400",
  cancelled: "bg-[#484F58]",
};

function StatusChip({ status }: { status: string | null }) {
  if (!status) return <span className="text-[#484F58] text-xs">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_COLORS[status] ?? "bg-[#1C2128] text-[#7D8590] border-[#30363D]"}`}>
      {status}
    </span>
  );
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function lsGet(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

function deriveCategory(name: string): string {
  const idx = name.indexOf(": ");
  if (idx > 0) return name.slice(0, idx);
  return "General";
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return format(new Date(iso), "MMM d");
}

// ── useResize hook ────────────────────────────────────────────────────────────

function useResize(key: string, def: number, min: number, max: number) {
  const [size, setSize] = useState(() => {
    const v = lsGet(key, String(def));
    const n = Number(v);
    return isNaN(n) ? def : Math.min(max, Math.max(min, n));
  });
  const persist = useCallback((v: number) => {
    const clamped = Math.min(max, Math.max(min, v));
    setSize(clamped);
    lsSet(key, String(clamped));
  }, [key, min, max]);
  return { size, persist };
}

// ── Resizable divider ─────────────────────────────────────────────────────────

function ResizeDivider({
  onDrag,
  axis = "x",
}: {
  onDrag: (delta: number) => void;
  axis?: "x" | "y";
}) {
  const dragging = useRef(false);
  const last = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    last.current = axis === "x" ? e.clientX : e.clientY;
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const cur = axis === "x" ? e.clientX : e.clientY;
      const delta = cur - last.current;
      last.current = cur;
      onDrag(delta);
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onDrag, axis]);

  return (
    <div
      onMouseDown={onMouseDown}
      className={`flex-shrink-0 ${axis === "x" ? "w-[3px] cursor-col-resize" : "h-[3px] cursor-row-resize"} bg-[#21262D] hover:bg-[#0078D4]/60 transition-colors group relative`}
    >
      <div className={`absolute inset-0 ${axis === "x" ? "-mx-1" : "-my-1"}`} />
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconPlay({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function IconStop({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 6h12v12H6z" />
    </svg>
  );
}
function IconSpinner({ className }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WorkflowListPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  // ── Modal / interaction state ──
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [activeRun, setActiveRun] = useState<{ defId: number; runId: number } | null>(null);
  const [inputDialog, setInputDialog] = useState<{ defId: number; fields: AskForInputField[] } | null>(null);

  // ── IDE state ──
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set(["⚙ System"]));
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [activityCollapsed, setActivityCollapsed] = useState(() => window.innerWidth < 1024);

  // ── Resize ──
  const sidebar = useResize("wf-sidebar-w", 240, 160, 420);
  const activity = useResize("wf-activity-w", 260, 180, 420);

  // Auto-collapse activity feed on narrow viewports
  useEffect(() => {
    const check = () => {
      if (window.innerWidth < 1024) setActivityCollapsed(true);
    };
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── Data queries ──
  const { data: defs = [], isLoading } = useQuery<WfDefinition[]>({
    queryKey: ["wf-definitions"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/workflows/definitions");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
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

  const selectedDef = defs.find(d => d.id === selectedId) ?? null;

  // ── Activity feed ──
  const isLiveRun = (selectedDef?.lastRunStatus === "running" || selectedDef?.lastRunStatus === "pending") || activeRun?.defId === selectedId;
  const { data: recentRuns, isLoading: runsLoading } = useQuery<WfRun[]>({
    queryKey: ["wf-recent-runs", selectedId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs?definitionId=${selectedId}&limit=10`);
      if (!res.ok) return [];
      const body = await res.json() as { runs?: WfRun[] } | WfRun[];
      return Array.isArray(body) ? body : (body.runs ?? []);
    },
    enabled: selectedId !== null,
    refetchInterval: isLiveRun ? 5000 : false,
  });

  // ── Active run status polling ──
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
        void qc.invalidateQueries({ queryKey: ["wf-recent-runs", activeRun.defId] });
      }, 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [activeRun, activeRunStatus, qc]);

  // ── Mutations ──
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

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wf-definitions"] });
      setDeleteId(null);
      if (selectedId === deleteId) setSelectedId(null);
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
        toast({ title: "No version published", description: `"${data.name ?? "Workflow"}" was synced but has no published version — open the builder and publish a version first.`, variant: "destructive" });
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
      qc.invalidateQueries({ queryKey: ["wf-recent-runs", data.defId] });
      toast({
        title: "Run started",
        description: (
          <span>
            Workflow is running.{" "}
            <button className="underline font-medium" onClick={() => navigate(`/workflows/runs?definitionId=${data.defId}`)}>
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

  function handlePlayClick(def: WfDefinition) {
    const fields = def.askForInputFields;
    if (fields && fields.length > 0) {
      setInputDialog({ defId: def.id, fields });
    } else {
      runMut.mutate({ id: def.id });
    }
  }

  // ── Category grouping ──
  const userDefs = defs.filter(d => !d.metadata?.system);
  const systemDefs = defs.filter(d => d.metadata?.system);

  const q = search.toLowerCase();

  interface CategoryGroup { name: string; defs: WfDefinition[] }

  function buildGroups(items: WfDefinition[]): CategoryGroup[] {
    const map = new Map<string, WfDefinition[]>();
    for (const d of items) {
      const cat: string = (d.metadata?.category as string | undefined) ?? deriveCategory(d.name);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(d);
    }
    return [...map.entries()].map(([name, defs]) => ({ name, defs })).sort((a, b) => a.name.localeCompare(b.name));
  }

  function filterGroups(groups: CategoryGroup[]): CategoryGroup[] {
    if (!q) return groups;
    return groups
      .map(g => ({
        name: g.name,
        defs: g.defs.filter(d => d.name.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)),
      }))
      .filter(g => g.defs.length > 0);
  }

  const userGroups = filterGroups(buildGroups(userDefs));
  const systemGroupDefs = !q ? systemDefs : systemDefs.filter(d => d.name.toLowerCase().includes(q) || "system".includes(q));

  // Flat ordered list for keyboard nav
  const flatLeaves: number[] = [];
  for (const g of userGroups) {
    if (!collapsedCategories.has(g.name)) {
      for (const d of g.defs) flatLeaves.push(d.id);
    }
  }
  if (systemGroupDefs.length > 0 && !collapsedCategories.has("⚙ System")) {
    for (const d of systemGroupDefs) flatLeaves.push(d.id);
  }

  // ── Keyboard navigation ──
  const handleSidebarKeyDown = (e: React.KeyboardEvent) => {
    // Do not intercept when focus is inside an editable control (search input, etc.)
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable
    ) return;

    const idx = selectedId !== null ? flatLeaves.indexOf(selectedId) : -1;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = idx < flatLeaves.length - 1 ? flatLeaves[idx + 1] : flatLeaves[0];
      if (next !== undefined) setSelectedId(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = idx > 0 ? flatLeaves[idx - 1] : flatLeaves[flatLeaves.length - 1];
      if (prev !== undefined) setSelectedId(prev);
    } else if (e.key === "Enter" && selectedId !== null) {
      e.preventDefault();
      navigate(`/workflows/builder/${selectedId}`);
    } else if (e.key === "F5" && selectedId !== null) {
      e.preventDefault();
      const def = defs.find(d => d.id === selectedId);
      if (def) handlePlayClick(def);
    } else if (e.key === "Delete" && selectedId !== null) {
      e.preventDefault();
      const def = defs.find(d => d.id === selectedId);
      if (def && !def.metadata?.system) setDeleteId(selectedId);
    }
  };

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const runningFromDefs = defs.filter(d => d.lastRunStatus === "running" || d.lastRunStatus === "pending").length;
  const activeRunAlreadyCounted = activeRun !== null && defs.some(d => d.id === activeRun.defId && (d.lastRunStatus === "running" || d.lastRunStatus === "pending"));
  const runningCount = runningFromDefs + (activeRun && !activeRunAlreadyCounted ? 1 : 0);

  // ── Sidebar leaf row ──
  function SidebarLeaf({ def, isSystem }: { def: WfDefinition; isSystem: boolean }) {
    const isSelected = selectedId === def.id;
    const isRunning = runningId === def.id;
    const isActiveRunDef = activeRun?.defId === def.id;
    const canRun = def.triggerTypes.includes("manual") || def.triggerTypes.includes("schedule");
    const dotColor = STATUS_DOT_COLORS[def.lastRunStatus ?? ""] ?? "bg-[#30363D]";
    const isLiveRunForThis = isActiveRunDef || (def.lastRunStatus === "running" || def.lastRunStatus === "pending");

    return (
      <div
        onClick={() => setSelectedId(def.id)}
        className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none transition-colors ${
          isSelected
            ? "bg-[#0078D4]/20 border-l-2 border-[#0078D4]"
            : "border-l-2 border-transparent hover:bg-[#1C2128]"
        }`}
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${isLiveRunForThis ? (STATUS_DOT_COLORS["running"] ?? dotColor) : dotColor}`}
        />
        <span className={`flex-1 text-xs truncate ${isSystem ? "text-[#8B949E]" : "text-[#C9D1D9]"} ${isSelected ? "text-[#E6EDF3] font-medium" : ""}`}>
          {def.name}
        </span>
        {canRun && (
          <button
            onClick={e => { e.stopPropagation(); isActiveRunDef ? (activeRun && stopMut.mutate(activeRun.runId)) : handlePlayClick(def); }}
            disabled={isRunning}
            className={`opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all flex-shrink-0 ${
              isActiveRunDef
                ? "text-red-400 hover:text-red-300"
                : "text-emerald-400 hover:text-emerald-300"
            } disabled:opacity-30`}
            title={isActiveRunDef ? "Stop" : "Run now"}
          >
            {isRunning ? <IconSpinner className="w-3 h-3" /> : isActiveRunDef ? <IconStop className="w-3 h-3" /> : <IconPlay className="w-3 h-3" />}
          </button>
        )}
      </div>
    );
  }

  // ── Sidebar folder row ──
  function SidebarFolder({ name, count, isSystem = false }: { name: string; count: number; isSystem?: boolean }) {
    const isCollapsed = collapsedCategories.has(name);
    return (
      <button
        onClick={() => toggleCategory(name)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-[#1C2128] transition-colors group"
      >
        <svg
          className={`w-3 h-3 text-[#484F58] flex-shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className={`text-[11px] font-semibold uppercase tracking-wider flex-1 truncate ${isSystem ? "text-[#484F58]" : "text-[#7D8590]"}`}>
          {name}
        </span>
        <span className="text-[10px] text-[#484F58] bg-[#21262D] rounded-full px-1.5 py-px font-medium flex-shrink-0">
          {count}
        </span>
      </button>
    );
  }

  // ── Detail panel ──
  function DetailPanel({ def }: { def: WfDefinition }) {
    const isRunning = runningId === def.id;
    const isActiveRunDef = activeRun?.defId === def.id;
    const canRun = def.triggerTypes.includes("manual") || def.triggerTypes.includes("schedule");
    const isSystem = !!def.metadata?.system;
    const trigCats = deriveTriggerCategories(def.triggerEventNames ?? []);

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Detail header */}
        <div className="px-6 py-5 border-b border-[#21262D] flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isSystem ? "bg-violet-500/10 border border-violet-500/20" : "bg-[#0078D4]/10 border border-[#0078D4]/20"}`}>
              {isSystem ? (
                <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-[#0078D4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-[#E6EDF3] leading-tight">{def.name}</h2>
              {def.description && <p className="text-xs text-[#7D8590] mt-1 leading-relaxed">{def.description}</p>}
            </div>
          </div>

          {/* Trigger category badges */}
          {trigCats.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {trigCats.map(cat => <CategoryPill key={cat} category={cat} />)}
              {def.triggerTypes.map(t => (
                <span key={t} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-[#1C2128] text-[#8B949E] border-[#30363D]">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Metadata chips */}
        <div className="px-6 py-4 border-b border-[#21262D] flex-shrink-0">
          <div className="flex flex-wrap gap-4">
            <div>
              <span className="text-[10px] text-[#484F58] uppercase tracking-wider block mb-1">Status</span>
              <StatusChip status={def.lastRunStatus} />
            </div>
            {def.publishedVersionLabel && (
              <div>
                <span className="text-[10px] text-[#484F58] uppercase tracking-wider block mb-1">Version</span>
                <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-medium">
                  {def.publishedVersionLabel}
                </span>
              </div>
            )}
            <div>
              <span className="text-[10px] text-[#484F58] uppercase tracking-wider block mb-1">Triggers</span>
              <span className="text-xs text-[#C9D1D9]">{def.triggerCount}</span>
            </div>
            <div>
              <span className="text-[10px] text-[#484F58] uppercase tracking-wider block mb-1">Concurrency</span>
              <span className="text-xs text-[#C9D1D9]">max {def.concurrencyLimit}</span>
            </div>
            {def.lastRunAt && (
              <div>
                <span className="text-[10px] text-[#484F58] uppercase tracking-wider block mb-1">Last Run</span>
                <span className="text-xs text-[#C9D1D9]">{format(new Date(def.lastRunAt), "MMM d, yyyy h:mm a")}</span>
              </div>
            )}
            <div>
              <span className="text-[10px] text-[#484F58] uppercase tracking-wider block mb-1">Created</span>
              <span className="text-xs text-[#C9D1D9]">{format(new Date(def.createdAt), "MMM d, yyyy")}</span>
            </div>
          </div>
        </div>

        {/* Action toolbar */}
        <div className="px-6 py-4 border-b border-[#21262D] flex-shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            {canRun && (
              <button
                onClick={() => isActiveRunDef ? (activeRun && stopMut.mutate(activeRun.runId)) : handlePlayClick(def)}
                disabled={isRunning}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 ${
                  isActiveRunDef
                    ? "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20"
                    : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                }`}
              >
                {isRunning ? <IconSpinner className="w-3.5 h-3.5" /> : isActiveRunDef ? <IconStop className="w-3.5 h-3.5" /> : <IconPlay className="w-3.5 h-3.5" />}
                {isRunning ? "Starting…" : isActiveRunDef ? "Stop Run" : "Run Now"}
              </button>
            )}

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
              onClick={() => navigate(`/workflows/triggers/${def.id}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] hover:bg-[#21262D] text-[#8B949E] hover:text-[#C9D1D9] text-xs font-medium rounded-lg border border-[#30363D] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Edit Triggers
            </button>

            <button
              onClick={() => navigate(`/workflows/runs?definitionId=${def.id}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] hover:bg-[#21262D] text-[#8B949E] hover:text-[#C9D1D9] text-xs font-medium rounded-lg border border-[#30363D] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              View Runs
            </button>

            <button
              onClick={() => publishToProdMut.mutate(def.id)}
              disabled={!prodDbConnected || def.publishedVersionNumber === null || publishToProdMut.isPending}
              title={
                !prodDbConnected
                  ? "Production database not configured — set DATABASE_URL_PROD in Replit Secrets"
                  : def.publishedVersionNumber === null
                  ? "Publish a version first — no published version exists for this workflow"
                  : "Publish this workflow to the production database"
              }
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] hover:bg-[#21262D] text-emerald-400 hover:text-emerald-300 text-xs font-medium rounded-lg border border-[#30363D] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Publish to Prod
            </button>

            {!isSystem && (
              <button
                onClick={() => setDeleteId(def.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] hover:bg-red-500/10 text-[#484F58] hover:text-red-400 text-xs font-medium rounded-lg border border-[#30363D] hover:border-red-500/20 transition-colors ml-auto"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Scrollable content area - could be extended later */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-4">
            {def.triggerEventNames && def.triggerEventNames.length > 0 && (
              <div>
                <p className="text-[10px] text-[#484F58] uppercase tracking-wider mb-2">Event Triggers</p>
                <div className="flex flex-wrap gap-1.5">
                  {def.triggerEventNames.map(ev => (
                    <span key={ev} className="text-[10px] bg-[#1C2128] border border-[#30363D] text-[#7D8590] px-2 py-0.5 rounded font-mono">
                      {ev}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {def.askForInputFields && def.askForInputFields.length > 0 && (
              <div>
                <p className="text-[10px] text-[#484F58] uppercase tracking-wider mb-2">Input Fields</p>
                <div className="space-y-1">
                  {def.askForInputFields.map(f => (
                    <div key={f.variableName} className="flex items-center gap-2 text-xs">
                      <span className="text-[#7D8590] font-mono">{f.variableName}</span>
                      <span className="text-[#484F58]">·</span>
                      <span className="text-[#484F58]">{f.type}</span>
                      {f.required && <span className="text-red-400 text-[10px]">required</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Activity feed panel ──
  function ActivityPanel() {
    if (!selectedId) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center px-4">
          <svg className="w-8 h-8 text-[#30363D] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-[11px] text-[#484F58]">Select a workflow</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-[#21262D] flex-shrink-0 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[#7D8590] uppercase tracking-wider">Recent Runs</span>
          {isLiveRun && (
            <span className="flex items-center gap-1 text-[10px] text-blue-400">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Live
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {runsLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-[#1C2128] rounded animate-pulse" />
              ))}
            </div>
          ) : !recentRuns || recentRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <p className="text-[11px] text-[#484F58]">No runs yet</p>
            </div>
          ) : (
            <div className="divide-y divide-[#21262D]">
              {recentRuns.map(run => {
                const dotCls = STATUS_DOT_COLORS[run.status] ?? "bg-[#30363D]";
                const durMs = run.durationMs ?? (run.completedAt && run.startedAt
                  ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
                  : null);
                const durStr = durMs !== null ? `${(durMs / 1000).toFixed(1)}s` : null;
                const ts = run.startedAt ?? run.createdAt;
                return (
                  <div key={run.id} className="px-4 py-2.5 hover:bg-[#1C2128] transition-colors">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotCls}`} />
                      <span className="text-[11px] text-[#C9D1D9] flex-1 font-medium capitalize">{run.status}</span>
                      {durStr && <span className="text-[10px] text-[#484F58]">{durStr}</span>}
                    </div>
                    <p className="text-[10px] text-[#484F58] mt-0.5 pl-4">{formatRelative(ts)}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-[#21262D] flex-shrink-0">
          <button
            onClick={() => navigate(`/workflows/runs?definitionId=${selectedId}`)}
            className="text-[11px] text-[#0078D4] hover:text-[#58A6FF] transition-colors"
          >
            View all runs →
          </button>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#0D1117] overflow-hidden">

      {/* IDE shell — three-column layout */}
      <div className="flex flex-1 min-h-0">

        {/* ── Left sidebar — Workflow Explorer ── */}
        <div
          ref={sidebarRef}
          className="flex flex-col flex-shrink-0 bg-[#161B22] border-r border-[#21262D] overflow-hidden outline-none"
          style={{ width: sidebar.size }}
          tabIndex={0}
          onKeyDown={handleSidebarKeyDown}
        >
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#21262D] flex-shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#484F58]">Explorer</span>
            <button
              onClick={() => setShowCreate(true)}
              className="p-1 rounded text-[#484F58] hover:text-[#0078D4] hover:bg-[#0078D4]/10 transition-colors"
              title="New Workflow"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-[#21262D] flex-shrink-0">
            <div className="flex items-center gap-2 bg-[#0D1117] border border-[#30363D] rounded-md px-2 py-1">
              <svg className="w-3 h-3 text-[#484F58] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search workflows…"
                className="flex-1 bg-transparent text-[11px] text-[#E6EDF3] placeholder-[#484F58] outline-none"
              />
              {search && (
                <button onClick={() => setSearch("")} className="text-[#484F58] hover:text-[#7D8590] transition-colors">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Tree */}
          <div className="flex-1 overflow-y-auto py-1">
            {isLoading ? (
              <div className="space-y-1 p-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-6 bg-[#1C2128] rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                {userGroups.length === 0 && systemGroupDefs.length === 0 ? (
                  <div className="px-3 py-6 text-center">
                    <p className="text-[11px] text-[#484F58]">{search ? "No matches" : "No workflows yet"}</p>
                  </div>
                ) : (
                  <>
                    {userGroups.map(group => (
                      <div key={group.name}>
                        <SidebarFolder name={group.name} count={group.defs.length} />
                        {!collapsedCategories.has(group.name) && (
                          <div className="pl-3">
                            {group.defs.map(def => <SidebarLeaf key={def.id} def={def} isSystem={false} />)}
                          </div>
                        )}
                      </div>
                    ))}

                    {systemGroupDefs.length > 0 && (
                      <div className="mt-1">
                        <SidebarFolder name="⚙ System" count={systemGroupDefs.length} isSystem />
                        {!collapsedCategories.has("⚙ System") && (
                          <div className="pl-3">
                            {systemGroupDefs.map(def => <SidebarLeaf key={def.id} def={def} isSystem />)}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Left resize divider */}
        <ResizeDivider onDrag={delta => sidebar.persist(sidebar.size + delta)} />

        {/* ── Center panel — Workflow Detail ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#0D1117] overflow-hidden">
          {selectedDef ? (
            <DetailPanel def={selectedDef} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="w-16 h-16 bg-[#1C2128] border border-[#30363D] rounded-2xl flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-[#484F58]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </div>
              <p className="text-[#E6EDF3] font-medium text-sm">Select a workflow</p>
              <p className="text-xs text-[#7D8590] mt-1 max-w-xs">
                Choose a workflow from the explorer to view details and manage it here.
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-[#0078D4] hover:bg-[#006CBD] text-white text-xs font-medium rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Workflow
              </button>
            </div>
          )}
        </div>

        {/* Right resize divider — hidden when activity is collapsed */}
        {!activityCollapsed && (
          <ResizeDivider onDrag={delta => activity.persist(activity.size - delta)} />
        )}

        {/* ── Right panel — Activity Feed (collapses to icon strip on narrow screens) ── */}
        {activityCollapsed ? (
          <div className="flex-shrink-0 w-10 bg-[#161B22] border-l border-[#21262D] flex flex-col items-center py-2 gap-3">
            <button
              onClick={() => setActivityCollapsed(false)}
              title="Show activity feed"
              className="p-1.5 rounded text-[#484F58] hover:text-[#0078D4] hover:bg-[#0078D4]/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </button>
            {isLiveRun && (
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" title="Run in progress" />
            )}
            {selectedId && recentRuns && recentRuns.length > 0 && (
              <span className="text-[9px] text-[#484F58] font-mono leading-none">{recentRuns.length}</span>
            )}
          </div>
        ) : (
          <div
            className="flex-shrink-0 bg-[#161B22] border-l border-[#21262D] overflow-hidden flex flex-col"
            style={{ width: activity.size }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#21262D] flex-shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#484F58]">Activity</span>
              <button
                onClick={() => setActivityCollapsed(true)}
                title="Collapse activity feed"
                className="p-0.5 rounded text-[#484F58] hover:text-[#7D8590] hover:bg-[#1C2128] transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ActivityPanel />
            </div>
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center justify-between px-4 h-7 flex-shrink-0 bg-[#0A2540] border-t border-[#1C2128]">
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-[#58A6FF] font-mono">
            {defs.length} workflow{defs.length !== 1 ? "s" : ""}
          </span>
          {runningCount > 0 && (
            <span className="flex items-center gap-1.5 text-[10px] text-blue-300 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              {runningCount} running
            </span>
          )}
          {selectedDef && (
            <span className="text-[10px] text-[#484F58] font-mono truncate max-w-[200px]">
              {selectedDef.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${prodDbConnected ? "bg-emerald-400" : "bg-[#484F58]"}`} />
          <span className="text-[10px] text-[#484F58] font-mono">
            {prodDbConnected ? "prod connected" : "prod not configured"}
          </span>
        </div>
      </div>

      {/* ── Modals ── */}

      {/* Create dialog */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="font-semibold text-[#E6EDF3]">New Workflow</h2>
            <div className="space-y-3">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newName.trim()) createMut.mutate(); }}
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
