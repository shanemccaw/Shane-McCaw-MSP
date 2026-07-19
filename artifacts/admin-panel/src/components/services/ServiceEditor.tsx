import { useState, useEffect, useCallback, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ChevronDown, ChevronUp, Plus, Trash2, Save, Loader2,
  Sparkles, Cloud, Bot, Shield, Zap, Server, Users,
  Layout as LayoutIcon, ShieldCheck, Lock, Globe, Settings, FileText,
  BarChart2, Award, Briefcase, Target, Code, Database, Monitor, Cpu,
  BookOpen, MessageSquare, Calendar, Star, Layers, ArrowLeft, CheckCircle, Clock,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useService, useCreateService, useUpdateService } from "@/hooks/useServices";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TagInput } from "@/components/TagInput";
import ArrayEditor from "./ArrayEditor";
import ServiceEditorSidePanel from "./ServiceEditorSidePanel";
import CategoryPickerDropdown from "./CategoryPickerDropdown";
import type { WizardStep, WizardOption } from "@/hooks/useServices";
import {
  detectProductType, PRODUCT_TYPE_CONFIGS, PRODUCT_TYPE_LIST, type ProductTypeConfig,
  type ProductTypeKey, type SectionDef, type FieldDef,
} from "@/lib/productTypeConfig";
import { useRegistryOptions } from "@/hooks/useRegistryOptions";

function nanoid() { return Math.random().toString(36).slice(2, 10); }

// ── Associated Documents ──────────────────────────────────────────────────────
// Structured mapping that drives the seeded Assessment document-generation
// workflow: each entry is one document to generate, with the docType/category
// that select the generator path and a customerVisible flag controlling whether
// it appears in the customer-facing presentation. docTypes mirror the taxonomy in
// api-server document-generator.ts. The consolidated SOW is intentionally NOT
// listed here — it is always generated last (so it grounds against these docs)
// and is always customer-visible. task_execution_guide is also omitted because it
// derives from the SOW, which does not yet exist during this document pass.

type AssociatedDocument = {
  docType: string;
  category: "report" | "consulting";
  title: string;
  customerVisible: boolean;
};

const ASSOC_DOC_TYPE_OPTIONS: { docType: string; category: "report" | "consulting"; label: string }[] = [
  { docType: "executive_summary", category: "report", label: "Executive Summary" },
  { docType: "full_readiness_report", category: "report", label: "Full Readiness Report" },
  { docType: "security_posture_report", category: "report", label: "Security Posture Report" },
  { docType: "governance_maturity_report", category: "report", label: "Governance Maturity Report" },
  { docType: "data_exposure_risk_report", category: "report", label: "Data Exposure Risk Report" },
  { docType: "license_optimization_report", category: "report", label: "License Optimization Report" },
  { docType: "remediation_plan", category: "consulting", label: "Remediation Plan" },
  { docType: "deployment_plan", category: "consulting", label: "Deployment Plan" },
  { docType: "governance_framework", category: "consulting", label: "Governance Framework" },
  { docType: "security_hardening_plan", category: "consulting", label: "Security Hardening Plan" },
  { docType: "copilot_enablement_plan", category: "consulting", label: "Copilot Enablement Plan" },
  { docType: "identity_modernization_plan", category: "consulting", label: "Identity Modernization Plan" },
];

function AssociatedDocumentsEditor({ value, onChange }: { value: AssociatedDocument[]; onChange: (v: AssociatedDocument[]) => void }) {
  const rows = value ?? [];
  const isDefaultTitle = (t: string) => ASSOC_DOC_TYPE_OPTIONS.some(o => o.label === t);
  const addDoc = () => {
    const used = new Set(rows.map(r => r.docType));
    const opt = ASSOC_DOC_TYPE_OPTIONS.find(o => !used.has(o.docType)) ?? ASSOC_DOC_TYPE_OPTIONS[0];
    onChange([...rows, { docType: opt.docType, category: opt.category, title: opt.label, customerVisible: true }]);
  };
  const updateDoc = (i: number, patch: Partial<AssociatedDocument>) =>
    onChange(rows.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const removeDoc = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const onDocTypeChange = (i: number, docType: string) => {
    const opt = ASSOC_DOC_TYPE_OPTIONS.find(o => o.docType === docType);
    if (!opt) return;
    // Auto-set category from docType; refresh the title only if it was still a default.
    updateDoc(i, {
      docType: opt.docType,
      category: opt.category,
      title: isDefaultTitle(rows[i].title) ? opt.label : rows[i].title,
    });
  };
  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No documents mapped yet. Add the documents this service's assessment should generate.
        </p>
      )}
      {rows.map((doc, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/50 p-3">
          <select
            value={doc.docType}
            onChange={e => onDocTypeChange(i, e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <optgroup label="Reports">
              {ASSOC_DOC_TYPE_OPTIONS.filter(o => o.category === "report").map(o => (
                <option key={o.docType} value={o.docType}>{o.label}</option>
              ))}
            </optgroup>
            <optgroup label="Consulting">
              {ASSOC_DOC_TYPE_OPTIONS.filter(o => o.category === "consulting").map(o => (
                <option key={o.docType} value={o.docType}>{o.label}</option>
              ))}
            </optgroup>
          </select>
          <input
            type="text"
            value={doc.title}
            onChange={e => updateDoc(i, { title: e.target.value })}
            placeholder="Document title"
            className="min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground whitespace-nowrap">
            <input
              type="checkbox"
              checked={doc.customerVisible}
              onChange={e => updateDoc(i, { customerVisible: e.target.checked })}
            />
            Customer-visible
          </label>
          <button
            type="button"
            onClick={() => removeDoc(i)}
            className="rounded-md p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
            aria-label="Remove document"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addDoc}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
      >
        <Plus className="h-4 w-4" /> Add document
      </button>
      <p className="text-xs text-muted-foreground">
        Documents marked <strong>customer-visible</strong> appear in the client presentation. Uncheck to generate a
        document internal-only (it grounds the SOW's accuracy but is hidden from the customer). The consolidated
        Statement of Work is always generated last and always shown — you don't need to add it here.
      </p>
    </div>
  );
}

function MultiCheckboxSelect({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter(k => k !== key) : [...value, key]);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {options.map(opt => (
        <label key={opt.key} className="flex items-start gap-2 cursor-pointer select-none group">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0 rounded border-border accent-cyan-500"
            checked={value.includes(opt.key)}
            onChange={() => toggle(opt.key)}
          />
          <span className="flex flex-col min-w-0">
            <span className="text-xs text-foreground leading-tight">{opt.label}</span>
            <code className="text-[10px] text-muted-foreground leading-tight">{opt.key}</code>
          </span>
        </label>
      ))}
    </div>
  );
}

function CapabilitiesEditor({
  value,
  onChange,
}: {
  value: Record<string, boolean>;
  onChange: (v: Record<string, boolean>) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(value);
  return (
    <div className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <code className="text-xs text-muted-foreground flex-1">{k}</code>
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={v}
              onChange={e => onChange({ ...value, [k]: e.target.checked })}
              className="rounded border-border accent-primary"
            />
            {v ? "Enabled" : "Disabled"}
          </label>
          <button
            type="button"
            onClick={() => {
              const next = { ...value };
              delete next[k];
              onChange(next);
            }}
            className="text-red-400 hover:text-red-300"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
      <div className="flex gap-2 mt-2">
        <input
          type="text"
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder="capability key"
          className="flex-1 border border-border rounded-lg px-2 py-1 text-xs bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          disabled={!newKey.trim()}
          onClick={() => {
            if (!newKey.trim()) return;
            onChange({ ...value, [newKey.trim()]: true });
            setNewKey("");
          }}
          className="text-xs border border-border px-2 py-1 rounded-lg hover:bg-accent text-muted-foreground disabled:opacity-40"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

const ICON_MAP: Record<string, LucideIcon> = {
  Cloud, Bot, Shield, Zap, Server, Users, Layout: LayoutIcon, Sparkles,
  ShieldCheck, Lock, Globe, Settings, FileText, BarChart2, Award,
  Briefcase, Target, Code, Database, Monitor, Cpu, BookOpen,
  MessageSquare, Calendar, Star, CheckCircle, Clock, Layers,
};
const ICON_NAMES = Object.keys(ICON_MAP).sort();

function resolveIcon(name: string | null): LucideIcon {
  if (!name) return Sparkles;
  const pascal = name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return ICON_MAP[pascal] ?? ICON_MAP[name] ?? Sparkles;
}

const CONSULTING_SITE_ROUTES: Array<string | RegExp> = [
  "/", "/about", "/services", "/services/microsoft-365", "/services/copilot-ai",
  "/services/sharepoint", "/services/power-platform", "/services/governance",
  "/services/cloud-migration", "/quick-wins", "/pricing", "/resources",
  /^\/resources\/[^/]+$/, "/contact", "/book", "/privacy", "/admin",
];

function validatePageHref(href: string | null | undefined): "empty" | "no-slash" | "unknown" | "ok" {
  if (!href) return "empty";
  if (!href.startsWith("/")) return "no-slash";
  return CONSULTING_SITE_ROUTES.some(r => typeof r === "string" ? r === href : r.test(href)) ? "ok" : "unknown";
}

const serviceSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  price: z.string().nullable(),
  basePrice: z.string().nullable(),
  maxPrice: z.string().nullable(),
  durationDays: z.number().nullable(),
  turnaround: z.string().nullable(),
  billingType: z.enum(["one_time", "recurring_monthly"]),
  visibility: z.enum(["public", "private", "landing_page_only"]),
  serviceType: z.string().nullable(),
  tagline: z.string().nullable(),
  targetAudience: z.string().nullable(),
  badge: z.string().nullable(),
  hoursPerMonth: z.string().nullable(),
  iconName: z.string().nullable(),
  pageHref: z.string().nullable(),
  sortOrder: z.number(),
  highlighted: z.boolean(),
  tier: z.string().nullable(),
  workflowTemplateId: z.number().nullable(),
  deliverables: z.array(z.string()),
  associatedDocuments: z.array(z.object({
    docType: z.string(),
    category: z.enum(["report", "consulting"]),
    title: z.string(),
    customerVisible: z.boolean(),
  })),
  inclusions: z.array(z.string()),
  features: z.array(z.string()),
  requiredAppPermissions: z.array(z.object({ scope: z.string(), reason: z.string() })),
  categoryPath: z.string().nullable(),
  tags: z.array(z.string()),
  fulfillmentTypeKey: z.string().nullable(),
  triggeringSignalKeys: z.array(z.string()),
  customerAgreementTemplate: z.string().nullable(),
  isFreeOffering: z.boolean(),
});

type ServiceFormValues = z.infer<typeof serviceSchema>;

interface WorkflowTemplateMeta { id: number; name: string; }
interface Client { id: number; email: string; name: string | null; company: string | null; }

function WorkflowBuilder({ serviceId, serviceName, onClose }: { serviceId: number; serviceName: string; onClose: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [steps, setSteps] = useState<WizardStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [allServices, setAllServices] = useState<{ id: number; name: string }[]>([]);
  const [showCopyFrom, setShowCopyFrom] = useState(false);
  const [copySourceId, setCopySourceId] = useState("");
  const [copyMode, setCopyMode] = useState<"replace" | "append">("replace");
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    void fetchWithAuth(`/api/admin/services/${serviceId}/workflow`)
      .then(r => r.json() as Promise<{ workflow: WizardStep[] }>)
      .then(d => { setSteps(d.workflow ?? []); setLoading(false); })
      .catch(() => setLoading(false));
    void fetchWithAuth("/api/admin/services")
      .then(r => r.json() as Promise<{ id: number; name: string }[]>)
      .then(d => setAllServices(d.filter(s => s.id !== serviceId)))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  const handleCopyFrom = async () => {
    if (!copySourceId) return;
    setCopying(true);
    try {
      const res = await fetchWithAuth(`/api/admin/services/${copySourceId}/workflow`);
      const data = await res.json() as { workflow: WizardStep[] };
      const imported = (data.workflow ?? []).map(st => ({ ...st, id: nanoid(), options: st.options.map((o: WizardOption) => ({ ...o, id: nanoid() })) }));
      setSteps(prev => copyMode === "append" ? [...prev, ...imported] : imported);
      setShowCopyFrom(false); setCopySourceId("");
    } finally { setCopying(false); }
  };

  const addStep = () => setSteps(s => [...s, { id: nanoid(), title: "", options: [] }]);
  const removeStep = (idx: number) => setSteps(s => s.filter((_, i) => i !== idx));
  const moveStep = (idx: number, dir: -1 | 1) => setSteps(s => { const a = [...s]; const n = idx + dir; if (n < 0 || n >= a.length) return a; [a[idx], a[n]] = [a[n], a[idx]]; return a; });
  const updateStepTitle = (idx: number, title: string) => setSteps(s => s.map((st, i) => i === idx ? { ...st, title } : st));
  const updateStepDesc = (idx: number, description: string) => setSteps(s => s.map((st, i) => i === idx ? { ...st, description } : st));
  const addOption = (si: number) => setSteps(s => s.map((st, i) => i === si ? { ...st, options: [...st.options, { id: nanoid(), label: "", description: "", priceAdjustment: 0 }] } : st));
  const removeOption = (si: number, oi: number) => setSteps(s => s.map((st, i) => i === si ? { ...st, options: st.options.filter((_, j) => j !== oi) } : st));
  const updateOption = (si: number, oi: number, field: keyof WizardOption, value: string | number) =>
    setSteps(s => s.map((st, i) => i === si ? { ...st, options: st.options.map((o, j) => j === oi ? { ...o, [field]: value } : o) } : st));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/services/${serviceId}/workflow`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow: steps }) });
      if (!res.ok) { const e = await res.json() as { error?: string }; setSaveError(e.error ?? "Save failed"); setTimeout(() => setSaveError(""), 4000); }
      else { setSavedMsg(true); setTimeout(() => setSavedMsg(false), 2500); }
    } catch { setSaveError("Network error"); setTimeout(() => setSaveError(""), 4000); }
    finally { setSaving(false); }
  };

  return (
    <div className="border border-primary/30 bg-accent rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h4 className="text-sm font-bold text-foreground">Project Template — {serviceName}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Build the questionnaire clients walk through to calculate their final price.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setShowCopyFrom(p => !p); setCopySourceId(""); }} className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${showCopyFrom ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-primary"}`}>Copy from…</button>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>
      </div>
      {showCopyFrom && (
        <div className="bg-card border border-border rounded-xl p-4 mb-4 space-y-3">
          <p className="text-xs font-semibold text-foreground">Copy workflow steps from another service</p>
          <select value={copySourceId} onChange={e => setCopySourceId(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground">
            <option value="">— Select a service —</option>
            {allServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="flex gap-4">
            {(["replace", "append"] as const).map(m => (
              <label key={m} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                <input type="radio" name="copyMode" value={m} checked={copyMode === m} onChange={() => setCopyMode(m)} />
                {m === "replace" ? "Replace" : "Append"}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => void handleCopyFrom()} disabled={!copySourceId || copying} className="flex items-center gap-1.5 text-xs bg-primary text-white px-3 py-1.5 rounded-lg font-medium hover:bg-[#006CBE] disabled:opacity-50">
              {copying ? <Loader2 className="w-3 h-3 animate-spin" /> : null}{copying ? "Copying…" : "Copy steps"}
            </button>
            <button onClick={() => setShowCopyFrom(false)} className="text-xs text-muted-foreground hover:text-foreground px-2">Cancel</button>
          </div>
        </div>
      )}
      {loading ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> : (
        <>
          {steps.length === 0 && <p className="text-sm text-muted-foreground bg-card border border-border rounded-lg px-4 py-3 mb-4">No steps yet. Add a step to create the wizard questionnaire.</p>}
          <div className="space-y-4">
            {steps.map((step, si) => (
              <div key={step.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveStep(si, -1)} disabled={si === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                    <button onClick={() => moveStep(si, 1)} disabled={si === steps.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                  </div>
                  <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-6 h-6 flex items-center justify-center">{si + 1}</span>
                  <input value={step.title} onChange={e => updateStepTitle(si, e.target.value)} placeholder="Step title" className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm bg-accent text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                  <button onClick={() => removeStep(si)} className="text-red-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="ml-12 mb-3">
                  <textarea value={step.description ?? ""} onChange={e => updateStepDesc(si, e.target.value)} placeholder="Description (optional)" rows={2} className="w-full border border-border rounded-lg px-3 py-1.5 text-xs bg-accent text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="ml-12 space-y-2">
                  {step.options.map((opt, oi) => (
                    <div key={opt.id} className="grid grid-cols-[1fr_110px_28px] gap-2 items-start">
                      <input value={opt.label} onChange={e => updateOption(si, oi, "label", e.target.value)} placeholder="Option label" className="border border-border rounded-lg px-3 py-1.5 text-xs bg-accent text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">+$</span>
                        <input type="number" min="0" step="1" value={opt.priceAdjustment} onChange={e => updateOption(si, oi, "priceAdjustment", parseFloat(e.target.value) || 0)} className="w-full border border-border rounded-lg pl-7 pr-3 py-1.5 text-xs bg-accent text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                      </div>
                      <button onClick={() => removeOption(si, oi)} className="text-red-400 h-[30px] flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => addOption(si)} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary transition-colors mt-1"><Plus className="w-3 h-3" />Add option</button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={addStep} className="flex items-center gap-2 border border-dashed border-primary/50 text-primary text-xs font-semibold px-4 py-2 rounded-lg hover:bg-primary/5"><Plus className="w-3.5 h-3.5" />Add step</button>
            <button onClick={() => void handleSave()} disabled={saving} className="flex items-center gap-2 bg-primary text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{saving ? "Saving…" : "Save Project Template"}
            </button>
            {savedMsg && <span className="text-xs text-emerald-400 font-semibold">✓ Saved</span>}
            {saveError && <span className="text-xs text-red-400">{saveError}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function PermissionsArrayEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const entries: { scope: string; reason: string }[] = Array.isArray(value)
    ? (value as { scope: string; reason: string }[]).map(e =>
        e && typeof e === "object"
          ? { scope: String((e as Record<string, unknown>).scope ?? ""), reason: String((e as Record<string, unknown>).reason ?? "") }
          : { scope: "", reason: "" }
      )
    : [];
  const cls = "border border-border rounded-lg px-3 py-2 text-xs bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary";
  const update = (i: number, key: "scope" | "reason", val: string) => {
    const next = entries.map((e, idx) => idx === i ? { ...e, [key]: val } : e);
    onChange(next.length > 0 ? next : null);
  };
  const remove = (i: number) => {
    const next = entries.filter((_, idx) => idx !== i);
    onChange(next.length > 0 ? next : null);
  };
  const add = () => onChange([...entries, { scope: "", reason: "" }]);
  return (
    <div className="space-y-2">
      {entries.map((e, i) => (
        <div key={i} className="flex gap-2 items-start">
          <div className="flex-1 grid grid-cols-2 gap-2">
            <input value={e.scope} onChange={ev => update(i, "scope", ev.target.value)} placeholder="Scope (e.g. User.Read.All)" className={cls} />
            <input value={e.reason} onChange={ev => update(i, "reason", ev.target.value)} placeholder="Reason" className={cls} />
          </div>
          <button type="button" onClick={() => remove(i)} className="text-red-400 hover:text-red-300 mt-2"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      <button type="button" onClick={add} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary">
        <Plus className="w-3.5 h-3.5" />Add permission
      </button>
    </div>
  );
}

interface FieldContext {
  fulfillmentTypes: { key: string; label: string }[];
  tenantSignals: { key: string; label: string }[];
  registryEngines: { key: string; label: string }[];
  registryFeatures: { key: string; label: string }[];
  workflowTemplates: WorkflowTemplateMeta[];
  allCategoryPaths: string[];
}

interface FieldRendererProps {
  field: FieldDef;
  coreValue: unknown;
  onCoreChange: (val: unknown) => void;
  taValue: unknown;
  onTaChange: (val: unknown) => void;
  ctx: FieldContext;
}

function FieldRenderer({ field, coreValue, onCoreChange, taValue, onTaChange, ctx }: FieldRendererProps) {
  const isTA = field.target === "typeAttributes";
  const value = isTA ? taValue : coreValue;
  const onChange = isTA ? onTaChange : onCoreChange;

  const cls = "w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

  switch (field.kind) {
    case "text":
      return (
        <input
          type="text"
          value={(value as string | null | undefined) ?? ""}
          onChange={e => onChange(e.target.value || null)}
          placeholder={field.placeholder}
          className={cls}
        />
      );

    case "textarea":
      return (
        <textarea
          rows={4}
          value={(value as string | null | undefined) ?? ""}
          onChange={e => onChange(e.target.value || null)}
          placeholder={field.placeholder}
          className={`${cls} resize-none`}
        />
      );

    case "number":
      return (
        <input
          type="number"
          value={(value as number | null | undefined) ?? ""}
          onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
          placeholder={field.placeholder}
          className={cls}
        />
      );

    case "currency":
      return (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={(value as string | number | null | undefined) ?? ""}
            onChange={e => onChange(e.target.value === "" ? null : e.target.value)}
            placeholder="0.00"
            className={`${cls} pl-7`}
          />
        </div>
      );

    case "boolean":
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={e => onChange(e.target.checked)}
            className="rounded border-border accent-primary w-4 h-4"
          />
          <span className="text-sm text-foreground">{field.label}</span>
        </label>
      );

    case "select": {
      const staticOpts = field.options ?? [];
      const dynamicOpts =
        field.key === "fulfillmentTypeKey" ? ctx.fulfillmentTypes.map(f => ({ value: f.key, label: f.label })) :
        field.key === "billingType" ? [{ value: "one_time", label: "One-time" }, { value: "recurring_monthly", label: "Monthly" }] :
        staticOpts;
      return (
        <select
          value={(value as string | null | undefined) ?? ""}
          onChange={e => onChange(e.target.value || null)}
          className={cls}
        >
          <option value="">— None —</option>
          {dynamicOpts.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    }

    case "multiselect": {
      const staticOpts = field.options ?? [];
      const dynamicOpts =
        field.key === "triggeringSignalKeys" ? ctx.tenantSignals.map(s => ({ value: s.key, label: s.label })) :
        staticOpts;
      const currentArr = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (v: string) =>
        onChange(currentArr.includes(v) ? currentArr.filter(x => x !== v) : [...currentArr, v]);
      if (dynamicOpts.length === 0) {
        return <p className="text-xs text-muted-foreground italic">No options available</p>;
      }
      return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {dynamicOpts.map(opt => (
            <label key={opt.value} className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 rounded border-border accent-primary"
                checked={currentArr.includes(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              <span className="text-xs text-foreground leading-tight">{opt.label}</span>
            </label>
          ))}
        </div>
      );
    }

    case "jsonb-array": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return <ArrayEditor value={arr} onChange={v => onChange(v)} placeholder={field.placeholder} />;
    }

    case "seat-range": {
      const pair = (value as [number | null, number | null] | null | undefined) ?? [null, null];
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">Min seats</label>
            <input
              type="number"
              min="0"
              value={pair[0] ?? ""}
              onChange={e => onChange([e.target.value === "" ? null : Number(e.target.value), pair[1]])}
              className={cls}
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">Max seats</label>
            <input
              type="number"
              min="0"
              value={pair[1] ?? ""}
              onChange={e => onChange([pair[0], e.target.value === "" ? null : Number(e.target.value)])}
              className={cls}
            />
          </div>
        </div>
      );
    }

    case "engine-picker": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <MultiCheckboxSelect
          options={ctx.registryEngines}
          value={selected}
          onChange={v => onChange(v)}
        />
      );
    }

    case "feature-picker": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <MultiCheckboxSelect
          options={ctx.registryFeatures}
          value={selected}
          onChange={v => onChange(v)}
        />
      );
    }

    case "capabilities-editor": {
      const caps = (value && typeof value === "object" && !Array.isArray(value))
        ? (value as Record<string, boolean>)
        : {};
      return <CapabilitiesEditor value={caps} onChange={v => onChange(v)} />;
    }

    case "icon-picker": {
      const cls = "w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary";
      return (
        <select
          value={(value as string | null | undefined) ?? ""}
          onChange={e => onChange(e.target.value || null)}
          className={cls}
        >
          <option value="">— None —</option>
          {ICON_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      );
    }

    case "category-path":
      return (
        <CategoryPickerDropdown
          value={(value as string | null | undefined) ?? null}
          onChange={v => onChange(v)}
          allCategoryPaths={ctx.allCategoryPaths}
        />
      );

    case "permissions-array":
      return <PermissionsArrayEditor value={value} onChange={onChange} />;

    default:
      return <p className="text-xs text-muted-foreground italic">Unsupported field kind</p>;
  }
}

interface Props {
  id: number | null;
  onClose: () => void;
  onSaved?: (id: number) => void;
  panelMode?: boolean;
  allCategoryPaths?: string[];
}

export default function ServiceEditor({ id, onClose, onSaved, panelMode = false, allCategoryPaths = [] }: Props) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const { engines: registryEngines, features: registryFeatures } = useRegistryOptions();
  const isNew = id === null;

  const { data: service, isLoading } = useService(id);
  const createService = useCreateService();
  const updateService = useUpdateService();

  const [clients, setClients] = useState<Client[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateMeta[]>([]);
  const [fulfillmentTypes, setFulfillmentTypes] = useState<{ key: string; label: string }[]>([]);
  const [tenantSignals, setTenantSignals] = useState<{ key: string; label: string }[]>([]);
  const [typeAttrs, setTypeAttrs] = useState<Record<string, unknown>>({});

  const [showWorkflow, setShowWorkflow] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [assignForm, setAssignForm] = useState({ clientUserId: "", serviceId: id ? String(id) : "", startDate: "", nextMilestone: "", nextMilestoneDate: "" });
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkResults, setBulkResults] = useState<{ succeeded: number; failed: number } | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const [createType, setCreateType] = useState<ProductTypeKey | null>(null);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [creating, setCreating] = useState(false);

  const defaultValues: ServiceFormValues = useMemo(() => ({
    name: service?.name ?? "",
    slug: service?.slug ?? null,
    category: service?.category ?? null,
    description: service?.description ?? null,
    price: service?.price ?? null,
    basePrice: service?.basePrice ?? null,
    maxPrice: service?.maxPrice ?? null,
    durationDays: service?.durationDays ?? null,
    turnaround: service?.turnaround ?? null,
    billingType: (service?.billingType === "recurring_monthly" ? "recurring_monthly" : "one_time") as "one_time" | "recurring_monthly",
    visibility: (service?.visibility as "public" | "private" | "landing_page_only") ?? "private",
    serviceType: service?.serviceType ?? null,
    tagline: service?.tagline ?? null,
    targetAudience: service?.targetAudience ?? null,
    badge: service?.badge ?? null,
    hoursPerMonth: service?.hoursPerMonth ?? null,
    iconName: service?.iconName ?? null,
    pageHref: service?.pageHref ?? null,
    sortOrder: service?.sortOrder ?? 0,
    highlighted: service?.highlighted ?? false,
    tier: service?.tier ?? null,
    workflowTemplateId: service?.workflowTemplateId ?? null,
    deliverables: service?.deliverables ?? [],
    associatedDocuments: ((service as { associatedDocuments?: AssociatedDocument[] } | null | undefined)?.associatedDocuments) ?? [],
    inclusions: service?.inclusions ?? [],
    features: service?.features ?? [],
    requiredAppPermissions: (service?.requiredAppPermissions as { scope: string; reason: string }[] | undefined) ?? [],
    categoryPath: service?.categoryPath ?? null,
    tags: service?.tags ?? [],
    fulfillmentTypeKey: service?.fulfillmentTypeKey ?? null,
    triggeringSignalKeys: service?.triggeringSignalKeys ?? [],
    customerAgreementTemplate: service?.customerAgreementTemplate ?? null,
    isFreeOffering: service?.isFreeOffering ?? false,
  }), [service]);

  const { register, handleSubmit, reset, watch, control, formState: { errors, isDirty }, setValue } = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues,
  });

  useEffect(() => {
    if (service) {
      reset(defaultValues);
      setTypeAttrs((service.typeAttributes as Record<string, unknown> | null) ?? {});
    }
  }, [service, reset, defaultValues]);

  const formWatch = watch();

  // Auto-populate fulfillmentTypeKey when serviceType changes to a type that has a known default
  const watchedServiceType = watch("serviceType");
  useEffect(() => {
    if (!watchedServiceType) return;
    const cfg = Object.values(PRODUCT_TYPE_CONFIGS).find(
      (c: ProductTypeConfig) => c.key === watchedServiceType,
    );
    if (!cfg?.defaultFulfillmentTypeKey) return;
    const current = (formWatch as Record<string, unknown>).fulfillmentTypeKey as string | null;
    if (!current) {
      setValue("fulfillmentTypeKey", cfg.defaultFulfillmentTypeKey, { shouldDirty: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedServiceType]);

  useEffect(() => {
    void (async () => {
      const [cr, wr, ftr, tsr] = await Promise.all([
        fetchWithAuth("/api/admin/clients"),
        fetchWithAuth("/api/admin/workflow-templates"),
        fetchWithAuth("/api/admin/fulfillment-types"),
        fetchWithAuth("/api/admin/engagement-projects/signals"),
      ]);
      if (cr.ok) setClients(await cr.json() as Client[]);
      if (wr.ok) setWorkflowTemplates(await wr.json() as WorkflowTemplateMeta[]);
      if (ftr.ok) {
        const d = await ftr.json() as { key: string; label: string }[];
        setFulfillmentTypes(Array.isArray(d) ? d : []);
      }
      if (tsr.ok) {
        const d = await tsr.json() as { key?: string; signalKey?: string; label?: string; name?: string }[];
        setTenantSignals(
          Array.isArray(d)
            ? d.map(s => ({ key: s.key ?? s.signalKey ?? "", label: s.label ?? s.name ?? s.key ?? s.signalKey ?? "" })).filter(s => s.key)
            : []
        );
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim() || !createType) return;
    const typeConfig = PRODUCT_TYPE_CONFIGS[createType];
    setCreating(true);
    try {
      const created = await createService.mutateAsync({
        name: createName.trim(),
        slug: createSlug.trim() || createName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
        billingType: typeConfig.defaultBillingType,
        visibility: "private",
        isPublic: false,
        serviceClass: typeConfig.serviceClass ?? undefined,
        deliveryType: typeConfig.deliveryType ?? undefined,
        fulfillmentType: typeConfig.fulfillmentType ?? undefined,
      });
      toast({ title: "Service created" });
      onSaved?.(created.id);
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally { setCreating(false); }
  }, [createName, createSlug, createType, createService, toast, onSaved]);

  const onSubmit = useCallback(async (values: ServiceFormValues): Promise<boolean> => {
    if (!id) return false;
    try {
      await updateService.mutateAsync({
        id,
        data: {
          ...values,
          isPublic: values.visibility === "public",
          deliverables: values.deliverables.length > 0 ? values.deliverables : null,
          associatedDocuments: values.associatedDocuments.length > 0 ? values.associatedDocuments : null,
          inclusions: values.inclusions.length > 0 ? values.inclusions : null,
          features: values.features.length > 0 ? values.features : null,
          requiredAppPermissions: values.requiredAppPermissions.length > 0 ? values.requiredAppPermissions : null,
          categoryPath: values.categoryPath ?? null,
          tags: values.tags.length > 0 ? values.tags : null,
          fulfillmentTypeKey: values.fulfillmentTypeKey ?? null,
          triggeringSignalKeys: values.triggeringSignalKeys.length > 0 ? values.triggeringSignalKeys : null,
          customerAgreementTemplate: values.customerAgreementTemplate ?? null,
          isFreeOffering: values.isFreeOffering,
          serviceClass: service?.serviceClass ?? null,
          deliveryType: service?.deliveryType ?? null,
          fulfillmentType: service?.fulfillmentType ?? undefined,
          typeAttributes: Object.keys(typeAttrs).length > 0 ? typeAttrs : undefined,
        },
      });
      toast({ title: "Service saved" });
      reset(values);
      onSaved?.(id);
      return true;
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
      return false;
    }
  }, [id, service, updateService, toast, reset, onSaved, typeAttrs]);

  const handleSaveAndClose = useCallback(async () => {
    let succeeded = false;
    await handleSubmit(async (values) => { succeeded = await onSubmit(values); })();
    if (succeeded) onClose();
  }, [handleSubmit, onSubmit, onClose]);

  const handleGeneratePdf = async () => {
    if (!id) return;
    setGeneratingPdf(true);
    try {
      const res = await fetchWithAuth(`/api/admin/services/${id}/generate-pdf`, { method: "POST" });
      const body = await res.json() as { overviewPdfKey?: string; error?: string };
      if (!res.ok) toast({ title: body.error ?? "PDF generation failed", variant: "destructive" });
      else toast({ title: "PDF generated successfully" });
    } finally { setGeneratingPdf(false); }
  };

  const handleViewPdf = async () => {
    if (!id) return;
    try {
      const urlRes = await fetchWithAuth(`/api/admin/services/${id}/pdf-url`);
      if (!urlRes.ok) { toast({ title: "No PDF yet — generate it first", variant: "destructive" }); return; }
      const { url } = await urlRes.json() as { url: string };
      const fileRes = await fetchWithAuth(url);
      if (!fileRes.ok) { toast({ title: "Could not download PDF", variant: "destructive" }); return; }
      const blob = await fileRes.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch { toast({ title: "Failed to open PDF", variant: "destructive" }); }
  };

  const handleGenerateAllPdfs = async () => {
    setBulkGenerating(true); setBulkProgress(null); setBulkResults(null);
    try {
      const res = await fetchWithAuth("/api/admin/services/generate-all-pdfs", { method: "POST" });
      if (!res.ok || !res.body) { toast({ title: "Failed to start", variant: "destructive" }); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as { type: string; total?: number; done?: number; succeeded?: number; failed?: number };
            if (evt.type === "start") setBulkProgress({ done: 0, total: evt.total ?? 0 });
            else if (evt.type === "progress") setBulkProgress({ done: evt.done ?? 0, total: evt.total ?? 0 });
            else if (evt.type === "done") { setBulkResults({ succeeded: evt.succeeded ?? 0, failed: evt.failed ?? 0 }); setBulkProgress(null); }
          } catch { /* ignore */ }
        }
      }
    } catch { toast({ title: "Bulk PDF generation failed", variant: "destructive" }); }
    finally { setBulkGenerating(false); }
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault(); setAssignError(""); setAssigning(true);
    try {
      const res = await fetchWithAuth("/api/admin/client-services", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientUserId: Number(assignForm.clientUserId), serviceId: Number(assignForm.serviceId),
          startDate: assignForm.startDate || null, nextMilestone: assignForm.nextMilestone || null,
          nextMilestoneDate: assignForm.nextMilestoneDate || null,
        }),
      });
      if (!res.ok) setAssignError((await res.json() as { error: string }).error);
      else {
        toast({ title: "Service assigned to client" });
        setShowAssign(false);
        setAssignForm({ clientUserId: "", serviceId: id ? String(id) : "", startDate: "", nextMilestone: "", nextMilestoneDate: "" });
      }
    } finally { setAssigning(false); }
  };

  const fieldCtx: FieldContext = useMemo(() => ({
    fulfillmentTypes,
    tenantSignals,
    registryEngines: registryEngines.map(e => ({ key: e.key, label: e.label })),
    registryFeatures: registryFeatures.map(f => ({ key: f.key, label: f.label })),
    workflowTemplates,
    allCategoryPaths,
  }), [fulfillmentTypes, tenantSignals, registryEngines, registryFeatures, workflowTemplates, allCategoryPaths]);

  // Helper: get/set value for a FieldDef on core form vs typeAttrs
  const getCoreValue = useCallback((key: string): unknown => {
    return (formWatch as Record<string, unknown>)[key] ?? null;
  }, [formWatch]);

  const setCoreValue = useCallback((key: string, val: unknown) => {
    setValue(key as keyof ServiceFormValues, val as never, { shouldDirty: true });
  }, [setValue]);

  const getTaValue = useCallback((key: string): unknown => {
    return typeAttrs[key] ?? null;
  }, [typeAttrs]);

  const setTaValue = useCallback((key: string, val: unknown) => {
    setTypeAttrs(prev => ({ ...prev, [key]: val }));
  }, []);

  // Render a config-driven section as a card
  const renderSection = useCallback((section: SectionDef) => {
    return (
      <div key={section.key} className="bg-card rounded-xl border border-border p-6 space-y-5">
        <div>
          <h3 className="text-sm font-bold text-foreground">{section.label}</h3>
        </div>
        <div className="space-y-4">
          {section.fields.map(f => (
            <div key={f.key}>
              {f.kind !== "boolean" && (
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">{f.label}</label>
              )}
              {f.hint && <p className="text-xs text-muted-foreground mb-1.5">{f.hint}</p>}
              <FieldRenderer
                field={f}
                coreValue={getCoreValue(f.key)}
                onCoreChange={val => setCoreValue(f.key, val)}
                taValue={getTaValue(f.key)}
                onTaChange={val => setTaValue(f.key, val)}
                ctx={fieldCtx}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }, [getCoreValue, setCoreValue, getTaValue, setTaValue, fieldCtx]);

  // ---- New service creation form ----
  if (isNew) {
    if (!createType) {
      return (
        <div className="flex h-full overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
            <div className="flex items-center gap-3 mb-6">
              {!panelMode && (
                <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <div>
                <h2 className="text-xl font-bold text-foreground">New Product</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Choose a product type to get started</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PRODUCT_TYPE_LIST.map(cfg => (
                <button
                  key={cfg.key}
                  type="button"
                  onClick={() => setCreateType(cfg.key)}
                  className="flex flex-col items-start gap-2 p-5 bg-card border border-border rounded-xl text-left hover:border-primary hover:bg-primary/5 transition-all group"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm font-bold text-foreground group-hover:text-primary">{cfg.label}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/60 bg-accent px-2 py-0.5 rounded">
                      {cfg.defaultBillingType === "recurring_monthly" ? "recurring" : cfg.defaultBillingType}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{cfg.description}</p>
                  {(cfg.showFields.assignToClient || cfg.showFields.genPdf || cfg.showFields.projectTemplate) && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {cfg.showFields.assignToClient && <span className="text-[10px] bg-accent text-muted-foreground px-1.5 py-0.5 rounded">Assign to Client</span>}
                      {cfg.showFields.projectTemplate && <span className="text-[10px] bg-accent text-muted-foreground px-1.5 py-0.5 rounded">Project Template</span>}
                      {cfg.showFields.genPdf && <span className="text-[10px] bg-accent text-muted-foreground px-1.5 py-0.5 rounded">PDF Overview</span>}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    const selectedTypeConfig = PRODUCT_TYPE_CONFIGS[createType];
    return (
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 max-w-xl">
          <div className="flex items-center gap-3 mb-6">
            <button type="button" onClick={() => setCreateType(null)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-xl font-bold text-foreground">New {selectedTypeConfig.label}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{selectedTypeConfig.description}</p>
            </div>
          </div>
          <form onSubmit={e => void handleCreate(e)} className="bg-card rounded-xl border border-border p-6 space-y-5">
            <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg">
              <span className="text-xs font-semibold text-primary">Type: {selectedTypeConfig.label}</span>
              <span className="text-xs text-muted-foreground ml-auto font-mono">{selectedTypeConfig.defaultBillingType}</span>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Name <span className="text-red-500">*</span></label>
              <input type="text" required autoFocus value={createName} onChange={e => {
                const name = e.target.value;
                setCreateName(name);
                setCreateSlug(prev => prev || name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
              }} placeholder="e.g. Microsoft 365 Audit"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Slug <span className="text-red-500">*</span></label>
              <input type="text" required value={createSlug}
                onChange={e => setCreateSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))}
                placeholder="url-friendly-slug"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <p className="text-xs text-muted-foreground">Visibility defaults to <strong className="text-foreground">Private</strong>. You can change all other settings after saving.</p>
            <button type="submit" disabled={creating || !createName.trim()}
              className="w-full bg-primary text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60">
              {creating ? "Creating…" : `Create ${selectedTypeConfig.label}`}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---- Loading skeleton ----
  if (isLoading || !service) {
    return (
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card flex-shrink-0">
            <div className="w-7 h-7 rounded-lg bg-accent animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-5 w-48 rounded bg-accent animate-pulse" />
              <div className="h-3 w-28 rounded bg-accent animate-pulse" />
            </div>
            <div className="flex gap-2">
              <div className="h-7 w-16 rounded-lg bg-accent animate-pulse" />
              <div className="h-7 w-24 rounded-lg bg-accent animate-pulse" />
              <div className="h-7 w-16 rounded-lg bg-primary/30 animate-pulse" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="bg-card rounded-xl border border-border p-6 space-y-5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-20 rounded bg-accent animate-pulse" />
                  <div className="h-9 rounded-lg bg-accent animate-pulse" style={{ width: `${60 + (i * 17) % 40}%` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <aside className="w-64 flex-shrink-0 border-l border-border bg-card p-4 space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-16 rounded bg-accent animate-pulse" />
              <div className="h-5 rounded bg-accent animate-pulse" style={{ width: `${50 + (i * 19) % 40}%` }} />
            </div>
          ))}
        </aside>
      </div>
    );
  }

  const saving = updateService.isPending;
  const productType = detectProductType(service.serviceClass, service.deliveryType, service.billingType, service.fulfillmentType);
  const typeConfig = PRODUCT_TYPE_CONFIGS[productType];

  const TYPE_BADGE_COLORS: Record<string, string> = {
    credit_pack: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    assessment: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    project: "bg-purple-500/15 text-purple-400 border-purple-500/20",
    retainer: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    monitoring_tier: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
    recurring_addon: "bg-orange-500/15 text-orange-400 border-orange-500/20",
    document_product: "bg-rose-500/15 text-rose-400 border-rose-500/20",
    platform_subscription_tier: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  };

  const Icon = resolveIcon(formWatch.iconName ?? null);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card flex-shrink-0">
          {!panelMode && (
            <button type="button" onClick={() => isDirty ? setDiscardOpen(true) : onClose()}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="flex items-center gap-2 w-8 h-8 rounded-lg bg-primary/10 shrink-0 justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-foreground truncate">{service.name}</h2>
              <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wide ${TYPE_BADGE_COLORS[productType] ?? "bg-accent text-muted-foreground border-border"}`}>
                {typeConfig.label}
              </span>
              {isDirty && (
                <span className="flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 uppercase tracking-wide">
                  Unsaved
                </span>
              )}
            </div>
            {service.slug && <p className="text-xs font-mono text-muted-foreground/60">{service.slug}</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button type="button" onClick={() => { reset(defaultValues); setTypeAttrs((service.typeAttributes as Record<string, unknown> | null) ?? {}); }}
              disabled={!isDirty || saving}
              className="px-3 py-1.5 text-xs font-medium border border-border text-muted-foreground rounded-lg hover:bg-accent hover:text-foreground disabled:opacity-40 transition-colors">
              Discard
            </button>
            <button type="button" onClick={() => void handleSaveAndClose()} disabled={saving}
              className="px-3 py-1.5 text-xs font-medium border border-border text-muted-foreground rounded-lg hover:bg-accent hover:text-foreground disabled:opacity-40 transition-colors">
              {saving ? "Saving…" : "Save & Close"}
            </button>
            <button type="button" onClick={() => void handleSubmit(onSubmit, (errs) => toast({ title: `Validation error: ${Object.keys(errs).join(", ")}`, variant: "destructive" }))()} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-primary hover:bg-[#006CBE] text-white rounded-lg disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border bg-background flex-shrink-0 flex-wrap">
          {typeConfig.showFields.assignToClient && (
            <button type="button" onClick={() => { setShowAssign(p => !p); setShowWorkflow(false); setAssignForm(f => ({ ...f, serviceId: String(id) })); }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${showAssign ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-primary"}`}>
              Assign to Client
            </button>
          )}
          {typeConfig.showFields.projectTemplate && (
            <button type="button" onClick={() => { setShowWorkflow(p => !p); setShowAssign(false); }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${showWorkflow ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-primary"}`}>
              {service.orderWorkflow && service.orderWorkflow.length > 0
                ? `Project Template (${service.orderWorkflow.length} step${service.orderWorkflow.length !== 1 ? "s" : ""})`
                : "Project Template"}
            </button>
          )}
          <div className="flex items-center gap-1.5 ml-auto">
            {typeConfig.showFields.genPdf && (
              <>
                <button type="button" onClick={() => void handleGeneratePdf()} disabled={generatingPdf}
                  className="flex items-center gap-1.5 text-xs border border-border text-muted-foreground px-3 py-1.5 rounded-lg hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors">
                  {generatingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {generatingPdf ? "Generating…" : "Gen PDF"}
                </button>
                {service.overviewPdfKey && (
                  <button type="button" onClick={() => void handleViewPdf()}
                    className="text-xs border border-border text-muted-foreground px-3 py-1.5 rounded-lg hover:bg-accent hover:text-foreground transition-colors">
                    View PDF
                  </button>
                )}
              </>
            )}
            <button type="button" onClick={() => void handleGenerateAllPdfs()} disabled={bulkGenerating}
              className="flex items-center gap-1.5 text-xs border border-border text-muted-foreground px-3 py-1.5 rounded-lg hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors">
              {bulkGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {bulkGenerating ? (bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}` : "Starting…") : "Regen All PDFs"}
            </button>
            {bulkResults && (
              <span className={`text-xs font-medium ${bulkResults.failed > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                {bulkResults.succeeded} OK{bulkResults.failed > 0 ? `, ${bulkResults.failed} failed` : ""}
              </span>
            )}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Assign panel */}
          {showAssign && (
            <div className="bg-accent border border-border rounded-xl p-5">
              <h3 className="text-sm font-bold text-foreground mb-4">Assign to Client</h3>
              <form onSubmit={e => void handleAssign(e)} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Client <span className="text-red-500">*</span></label>
                  <select required value={assignForm.clientUserId} onChange={e => setAssignForm(f => ({ ...f, clientUserId: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground">
                    <option value="">— Select Client —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name ?? c.email}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Start Date</label>
                  <input type="date" value={assignForm.startDate} onChange={e => setAssignForm(f => ({ ...f, startDate: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-accent text-foreground" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Next Milestone Date</label>
                  <input type="date" value={assignForm.nextMilestoneDate} onChange={e => setAssignForm(f => ({ ...f, nextMilestoneDate: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-accent text-foreground" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Milestone Description</label>
                  <input value={assignForm.nextMilestone} onChange={e => setAssignForm(f => ({ ...f, nextMilestone: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-accent text-foreground" />
                </div>
                {assignError && <div className="sm:col-span-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{assignError}</div>}
                <div className="sm:col-span-2 flex gap-3">
                  <button type="submit" disabled={assigning} className="bg-primary text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">{assigning ? "Assigning…" : "Assign Service"}</button>
                  <button type="button" onClick={() => { setShowAssign(false); setAssignError(""); }} className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground">Cancel</button>
                </div>
              </form>
            </div>
          )}

          {/* Workflow builder */}
          {showWorkflow && <WorkflowBuilder serviceId={id} serviceName={service.name} onClose={() => setShowWorkflow(false)} />}

          {/* Config-driven form sections */}
          <form id="service-form" onSubmit={e => void handleSubmit(onSubmit)(e)}>
            <div className="space-y-5">
              {typeConfig.sections.map(section => renderSection(section))}

              {/* Associated documents — drives the Assessment document-generation workflow */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="mb-1 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Associated Documents</h3>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  The documents this service's assessment automatically generates, in order, before the Statement of Work.
                </p>
                <Controller
                  name="associatedDocuments"
                  control={control}
                  render={({ field }) => (
                    <AssociatedDocumentsEditor value={field.value ?? []} onChange={field.onChange} />
                  )}
                />
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Side panel */}
      <ServiceEditorSidePanel form={formWatch} isDirty={isDirty} />

      {/* Discard dialog */}
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>You have unsaved changes. They will be lost if you go back.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={onClose} className="bg-red-600 hover:bg-red-700 text-white">Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
