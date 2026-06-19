import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  ChevronDown, ChevronUp, Plus, Trash2, Save, Loader2,
  CheckCircle, Clock, Sparkles, Cloud, Bot, Shield, Zap, Server, Users,
  Layout as LayoutIcon, ShieldCheck, Lock, Globe, Settings, FileText,
  BarChart2, Award, Briefcase, Target, Code, Database, Monitor, Cpu,
  BookOpen, MessageSquare, Calendar, Star, type LucideIcon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface WizardOption {
  id: string;
  label: string;
  description: string;
  priceAdjustment: number;
}

interface WizardStep {
  id: string;
  title: string;
  options: WizardOption[];
}

interface Service {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  deliverables: string | null;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  durationDays: number | null;
  turnaround: string | null;
  billingType: "one_time" | "recurring_monthly";
  isPublic: boolean;
  createdAt: string;
  serviceType: string | null;
  tagline: string | null;
  targetAudience: string | null;
  inclusions: string[] | null;
  features: string[] | null;
  badge: string | null;
  highlighted: boolean;
  hoursPerMonth: string | null;
  iconName: string | null;
  pageHref: string | null;
  sortOrder: number;
  orderWorkflow: WizardStep[] | null;
}

interface Client {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
}

interface AssignForm {
  clientUserId: string;
  serviceId: string;
  startDate: string;
  nextMilestone: string;
  nextMilestoneDate: string;
}

function nanoid() {
  return Math.random().toString(36).slice(2, 10);
}

// --- Offer Card Preview ---

const ICON_MAP: Record<string, LucideIcon> = {
  Cloud, Bot, Shield, Zap, Server, Users, Layout: LayoutIcon, Sparkles,
  ShieldCheck, Lock, Globe, Settings, FileText, BarChart2, Award,
  Briefcase, Target, Code, Database, Monitor, Cpu, BookOpen,
  MessageSquare, Calendar, Star, CheckCircle, Clock,
};

function resolveIcon(name: string | null): LucideIcon {
  if (!name) return Sparkles;
  const pascal = name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return ICON_MAP[pascal] ?? ICON_MAP[name] ?? Sparkles;
}

const BADGE_COLORS: Record<string, string> = {
  Popular: "bg-[#0078D4]/10 text-[#0078D4]",
  New: "bg-emerald-100 text-emerald-700",
  "Best Value": "bg-amber-100 text-amber-700",
  Featured: "bg-purple-100 text-purple-700",
};

function badgeClass(badge: string): string {
  return BADGE_COLORS[badge] ?? "bg-[#0078D4]/10 text-[#0078D4]";
}

function formatPricePreview(form: Partial<Service>): string {
  const fmt = (v: string | null | undefined) => {
    if (!v) return null;
    const n = parseFloat(v);
    if (isNaN(n)) return null;
    return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };
  const base = fmt(form.basePrice);
  const max = fmt(form.maxPrice);
  if (base && max) return `${base}–${max}`;
  if (base) return base;
  const single = fmt(form.price);
  if (single) return single;
  return "Contact for pricing";
}

function OfferCardPreview({ form }: { form: Partial<Service> }) {
  const Icon = resolveIcon(form.iconName ?? null);
  const priceDisplay = formatPricePreview(form);
  const inclusions = form.inclusions ?? [];
  const features = form.features ?? [];
  const billingLabel = form.billingType === "recurring_monthly" ? "Monthly retainer" : "One-time";

  return (
    <div className="bg-white rounded-xl border border-border p-6 flex flex-col shadow-sm">
      {/* Header row — icon + badge */}
      <div className="flex items-start justify-between mb-4">
        <div className="w-11 h-11 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-[#0078D4]" />
        </div>
        {form.badge && (
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${badgeClass(form.badge)}`}>
            {form.badge}
          </span>
        )}
      </div>

      {/* Category */}
      {form.category && (
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">
          {form.category}
        </p>
      )}

      {/* Price */}
      <p className="text-[#0078D4] text-3xl font-extrabold mb-1">{priceDisplay}</p>

      {/* Title */}
      <h3 className="text-xl font-bold text-[#0A2540] mb-1">{form.name || <span className="text-gray-300">Untitled Service</span>}</h3>

      {/* Tagline */}
      {form.tagline && (
        <p className="text-sm italic text-muted-foreground mb-3">{form.tagline}</p>
      )}

      {/* Description */}
      {form.description && (
        <p className="text-sm text-foreground leading-relaxed mb-4">{form.description}</p>
      )}

      {/* Meta row — turnaround + billing type */}
      <div className="flex flex-wrap gap-2 mb-4">
        {form.turnaround && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-[#F7F9FC] px-3 py-1.5 rounded-full border border-border">
            <Clock className="w-3.5 h-3.5 text-[#0078D4]" />
            {form.turnaround}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-[#F7F9FC] px-3 py-1.5 rounded-full border border-border">
          {billingLabel}
        </span>
      </div>

      {/* Target audience */}
      {form.targetAudience && (
        <p className="text-sm text-muted-foreground italic mb-4">
          <span className="font-semibold not-italic text-[#0A2540]">Best for:</span> {form.targetAudience}
        </p>
      )}

      {/* Deliverables */}
      {form.deliverables && (
        <div className="mb-4">
          <p className="text-sm font-semibold text-[#0A2540] mb-1.5">Deliverables:</p>
          <ul className="space-y-1">
            {form.deliverables.split("\n").filter(line => line.trim()).map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0" />
                {line.trim()}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What's Included */}
      {inclusions.length > 0 && (
        <div className="border-t border-border pt-4 mb-4">
          <p className="text-sm font-semibold text-[#0A2540] mb-3">What's Included:</p>
          <ul className="space-y-2">
            {inclusions.map((item, j) => (
              <li key={j} className="flex items-start gap-2 text-sm text-foreground">
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Features */}
      {features.length > 0 && features !== form.inclusions && (
        <div className="border-t border-border pt-4 mb-4">
          <p className="text-sm font-semibold text-[#0A2540] mb-3">Features:</p>
          <ul className="space-y-1.5">
            {features.map((item, j) => (
              <li key={j} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0 mt-1.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex-grow" />

      {/* CTA (non-interactive placeholder) */}
      <div className="w-full mt-6 bg-[#0078D4] text-white text-sm font-semibold text-center py-2.5 rounded-lg opacity-70 cursor-default select-none">
        Get Started
      </div>
    </div>
  );
}

function WorkflowBuilder({ service, onClose }: { service: Service; onClose: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [steps, setSteps] = useState<WizardStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    fetchWithAuth(`/api/admin/services/${service.id}/workflow`)
      .then(r => r.json() as Promise<{ workflow: WizardStep[] }>)
      .then(data => { setSteps(data.workflow ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.id]);

  const addStep = () => setSteps(s => [...s, { id: nanoid(), title: "", options: [] }]);
  const removeStep = (idx: number) => setSteps(s => s.filter((_, i) => i !== idx));
  const moveStep = (idx: number, dir: -1 | 1) => {
    setSteps(s => {
      const arr = [...s];
      const next = idx + dir;
      if (next < 0 || next >= arr.length) return arr;
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  };
  const updateStepTitle = (idx: number, title: string) =>
    setSteps(s => s.map((st, i) => i === idx ? { ...st, title } : st));
  const addOption = (stepIdx: number) =>
    setSteps(s => s.map((st, i) => i === stepIdx
      ? { ...st, options: [...st.options, { id: nanoid(), label: "", description: "", priceAdjustment: 0 }] }
      : st));
  const removeOption = (stepIdx: number, optIdx: number) =>
    setSteps(s => s.map((st, i) => i === stepIdx
      ? { ...st, options: st.options.filter((_, oi) => oi !== optIdx) }
      : st));
  const updateOption = (stepIdx: number, optIdx: number, field: keyof WizardOption, value: string | number) =>
    setSteps(s => s.map((st, i) => i === stepIdx
      ? { ...st, options: st.options.map((o, oi) => oi === optIdx ? { ...o, [field]: value } : o) }
      : st));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/services/${service.id}/workflow`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: steps }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setSaveError(err.error ?? "Failed to save workflow");
        setTimeout(() => setSaveError(""), 4000);
      } else {
        setSavedMsg(true);
        setSaveError("");
        setTimeout(() => setSavedMsg(false), 2500);
      }
    } catch {
      setSaveError("Network error — workflow not saved");
      setTimeout(() => setSaveError(""), 4000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-[#0078D4]/30 bg-[#F7F9FC] rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-bold text-[#0A2540]">Order Workflow — {service.name}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Build the questionnaire clients walk through to calculate their final price.</p>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-[#0A2540] font-medium">Close</button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[#0078D4]" /></div>
      ) : (
        <>
          {steps.length === 0 && (
            <p className="text-sm text-muted-foreground bg-white border border-border rounded-lg px-4 py-3 mb-4">
              No steps yet. Add a step to create the wizard questionnaire.
            </p>
          )}
          <div className="space-y-4">
            {steps.map((step, si) => (
              <div key={step.id} className="bg-white border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveStep(si, -1)} disabled={si === 0} className="text-muted-foreground hover:text-[#0A2540] disabled:opacity-30 transition-colors"><ChevronUp className="w-3.5 h-3.5" /></button>
                    <button onClick={() => moveStep(si, 1)} disabled={si === steps.length - 1} className="text-muted-foreground hover:text-[#0A2540] disabled:opacity-30 transition-colors"><ChevronDown className="w-3.5 h-3.5" /></button>
                  </div>
                  <span className="text-xs font-bold text-[#0078D4] bg-[#0078D4]/10 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">{si + 1}</span>
                  <input type="text" placeholder="Step title" value={step.title} onChange={e => updateStepTitle(si, e.target.value)}
                    className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                  <button onClick={() => removeStep(si)} className="text-red-400 hover:text-red-600 transition-colors flex-shrink-0"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="ml-12 space-y-2">
                  {step.options.length === 0 && <p className="text-xs text-muted-foreground italic">No options yet.</p>}
                  {step.options.map((opt, oi) => (
                    <div key={opt.id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_110px_28px] gap-2 items-start">
                      <input type="text" placeholder="Option label" value={opt.label} onChange={e => updateOption(si, oi, "label", e.target.value)}
                        className="border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                      <input type="text" placeholder="Short description (optional)" value={opt.description} onChange={e => updateOption(si, oi, "description", e.target.value)}
                        className="border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">+$</span>
                        <input type="number" min="0" step="1" placeholder="0" value={opt.priceAdjustment} onChange={e => updateOption(si, oi, "priceAdjustment", parseFloat(e.target.value) || 0)}
                          className="w-full border border-border rounded-lg pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                      </div>
                      <button onClick={() => removeOption(si, oi)} className="text-red-400 hover:text-red-600 transition-colors h-[30px] flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => addOption(si)} className="flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] hover:text-[#005A9E] transition-colors mt-1">
                    <Plus className="w-3 h-3" />Add option
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={addStep} className="flex items-center gap-2 border border-dashed border-[#0078D4]/50 text-[#0078D4] text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/5 transition-colors">
              <Plus className="w-3.5 h-3.5" />Add step
            </button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 bg-[#0078D4] text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? "Saving…" : "Save Workflow"}
            </button>
            {savedMsg && <span className="text-xs text-green-600 font-semibold">✓ Saved</span>}
            {saveError && <span className="text-xs text-red-600 font-semibold">{saveError}</span>}
          </div>
        </>
      )}
    </div>
  );
}

export default function ServicesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Service | null>(null);
  const [form, setForm] = useState<Partial<Service>>({});
  const [saving, setSaving] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", slug: "", billingType: "one_time" as "one_time" | "recurring_monthly" });
  const [creating, setCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [showWorkflow, setShowWorkflow] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [assignForm, setAssignForm] = useState<AssignForm>({
    clientUserId: "", serviceId: "", startDate: "", nextMilestone: "", nextMilestoneDate: "",
  });
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [svcRes, clientRes] = await Promise.all([
        fetchWithAuth("/api/admin/services"),
        fetchWithAuth("/api/admin/clients"),
      ]);
      if (svcRes.ok) setServices(await svcRes.json() as Service[]);
      else toast({ title: "Failed to load services", variant: "destructive" });
      if (clientRes.ok) setClients(await clientRes.json() as Client[]);
    } catch { toast({ title: "Could not reach API server", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  function selectService(s: Service) {
    setSelected(s);
    setForm({ ...s });
    setShowCreate(false);
    setShowWorkflow(false);
    setShowAssign(false);
    setAssignError("");
  }

  function setField(key: keyof Service, value: string | boolean | number | string[] | null) {
    setForm(p => ({ ...p, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/services/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify(form),
      });
      const body = await res.json() as Service & { error?: string };
      if (!res.ok) { toast({ title: (body as { error?: string }).error ?? "Save failed", variant: "destructive" }); return; }
      toast({ title: "Service saved" });
      setSelected(body);
      setForm({ ...body });
      await fetchAll();
    } finally { setSaving(false); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetchWithAuth("/api/admin/services", {
        method: "POST",
        body: JSON.stringify({
          name: createForm.name.trim(),
          slug: createForm.slug.trim() || null,
          billingType: createForm.billingType,
        }),
      });
      const body = await res.json() as Service & { error?: string };
      if (!res.ok) { toast({ title: body.error ?? "Create failed", variant: "destructive" }); return; }
      toast({ title: "Service created" });
      setShowCreate(false);
      setCreateForm({ name: "", slug: "", billingType: "one_time" });
      await fetchAll();
      selectService(body);
    } finally { setCreating(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/services/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        toast({
          title: "Cannot delete service",
          description: body.error ?? "Delete failed. Please try again.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Service deleted" });
      if (selected?.id === deleteTarget.id) { setSelected(null); setForm({}); }
      setDeleteTarget(null);
      await fetchAll();
    } finally {
      setDeleting(false);
    }
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    setAssignError("");
    setAssigning(true);
    try {
      const res = await fetchWithAuth("/api/admin/client-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientUserId: Number(assignForm.clientUserId),
          serviceId: Number(assignForm.serviceId),
          startDate: assignForm.startDate || null,
          nextMilestone: assignForm.nextMilestone || null,
          nextMilestoneDate: assignForm.nextMilestoneDate || null,
        }),
      });
      if (!res.ok) {
        setAssignError((await res.json() as { error: string }).error);
      } else {
        toast({ title: "Service assigned to client" });
        setShowAssign(false);
        setAssignForm({ clientUserId: "", serviceId: "", startDate: "", nextMilestone: "", nextMilestoneDate: "" });
        setAssignError("");
      }
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="flex h-full">
      {/* Service list */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-[#0A2540] text-sm">Service Offerings</h2>
            <p className="text-xs text-gray-500 mt-0.5">{services.length} services</p>
          </div>
          <button
            onClick={() => { setShowCreate(true); setSelected(null); setForm({}); setShowWorkflow(false); setShowAssign(false); }}
            className="flex items-center gap-1.5 bg-[#0078D4] text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-[#006CBE] transition-colors whitespace-nowrap"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New
          </button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="divide-y divide-gray-100 flex-1 overflow-y-auto">
            {services.map(s => (
              <div key={s.id} className={`group flex items-center gap-1 pr-2 hover:bg-gray-50 transition-colors ${selected?.id === s.id ? "bg-blue-50 border-l-2 border-[#0078D4]" : ""}`}>
                <button onClick={() => selectService(s)} className="flex-1 text-left px-4 py-3.5 min-w-0">
                  <p className="font-medium text-sm text-[#0A2540] leading-snug truncate">{s.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${s.billingType === "recurring_monthly" ? "bg-purple-100 text-purple-700" : "bg-green-100 text-green-700"}`}>
                      {s.billingType === "recurring_monthly" ? "Monthly retainer" : "One-time charge"}
                    </span>
                    {s.price && <span className="text-xs text-gray-500">${parseFloat(s.price).toLocaleString()}</span>}
                    {!s.price && s.basePrice && (
                      <span className="text-xs text-gray-500">
                        ${parseFloat(s.basePrice).toLocaleString()}{s.maxPrice ? `–$${parseFloat(s.maxPrice).toLocaleString()}` : "+"}
                      </span>
                    )}
                  </div>
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setDeleteTarget(s); }}
                  className="flex-shrink-0 p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                  title="Delete service"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail / edit panel */}
      <div className="flex-1 overflow-y-auto">
        {showCreate ? (
          <form onSubmit={handleCreate} className="p-6 max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[#0A2540]">New Service</h2>
              <button type="button" onClick={() => setShowCreate(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors text-sm">
                Cancel
              </button>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text" required autoFocus
                  value={createForm.name}
                  onChange={e => {
                    const name = e.target.value;
                    setCreateForm(p => ({
                      ...p,
                      name,
                      slug: p.slug || name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
                    }));
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="e.g. Microsoft 365 Audit"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                  Slug <span className="text-red-500">*</span>
                </label>
                <input
                  type="text" required
                  value={createForm.slug}
                  onChange={e => setCreateForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="url-friendly-slug"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Billing Type</label>
                <div className="flex gap-3">
                  {[
                    { value: "one_time", label: "One-time charge" },
                    { value: "recurring_monthly", label: "Monthly retainer" },
                  ].map(opt => (
                    <label key={opt.value} className={`flex items-center gap-2.5 flex-1 border rounded-xl p-3 cursor-pointer transition-all ${createForm.billingType === opt.value ? "border-[#0078D4] bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                      <input type="radio" name="createBillingType" value={opt.value}
                        checked={createForm.billingType === opt.value}
                        onChange={() => setCreateForm(p => ({ ...p, billingType: opt.value as "one_time" | "recurring_monthly" }))}
                        className="text-[#0078D4]" />
                      <span className="text-sm font-medium text-[#0A2540]">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button type="submit" disabled={creating || !createForm.name.trim()}
                className="w-full bg-[#0078D4] text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60">
                {creating ? "Creating…" : "Create Service"}
              </button>
            </div>
          </form>
        ) : !selected ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">Select a service to edit</p>
              <p className="text-xs mt-1">or click <span className="font-medium text-[#0078D4]">New</span> to create one</p>
            </div>
          </div>
        ) : (
          <div className="p-6">
            {/* Header with actions */}
            <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-[#0A2540]">Edit Service</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => { setShowAssign(p => !p); setShowWorkflow(false); setAssignError(""); setAssignForm(f => ({ ...f, serviceId: String(selected.id) })); }}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${showAssign ? "bg-[#0078D4] text-white border-[#0078D4]" : "border-gray-300 text-gray-600 hover:border-[#0078D4] hover:text-[#0078D4]"}`}
                >
                  Assign to Client
                </button>
                <button
                  type="button"
                  onClick={() => { setShowWorkflow(p => !p); setShowAssign(false); }}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${showWorkflow ? "bg-[#0078D4] text-white border-[#0078D4]" : "border-gray-300 text-gray-600 hover:border-[#0078D4] hover:text-[#0078D4]"}`}
                >
                  {selected.orderWorkflow && selected.orderWorkflow.length > 0
                    ? `Workflow (${selected.orderWorkflow.length} step${selected.orderWorkflow.length !== 1 ? "s" : ""})`
                    : "Workflow"}
                </button>
                <button
                  onClick={e => { e.preventDefault(); void handleSave(e as unknown as React.FormEvent); }}
                  disabled={saving}
                  className="bg-[#0078D4] text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>

            {/* Assign to Client panel */}
            {showAssign && (
              <div className="bg-[#F7F9FC] border border-border rounded-xl p-5 mb-6">
                <h3 className="text-sm font-bold text-[#0A2540] mb-4">Assign to Client</h3>
                <form onSubmit={handleAssign} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#0A2540] mb-1">Client <span className="text-red-500">*</span></label>
                    <select required value={assignForm.clientUserId} onChange={e => setAssignForm(f => ({ ...f, clientUserId: e.target.value }))}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                      <option value="">— Select Client —</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name ?? c.email}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0A2540] mb-1">Service <span className="text-red-500">*</span></label>
                    <select required value={assignForm.serviceId} onChange={e => setAssignForm(f => ({ ...f, serviceId: e.target.value }))}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                      <option value="">— Select Service —</option>
                      {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0A2540] mb-1">Start Date</label>
                    <input type="date" value={assignForm.startDate} onChange={e => setAssignForm(f => ({ ...f, startDate: e.target.value }))}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0A2540] mb-1">Next Milestone Date</label>
                    <input type="date" value={assignForm.nextMilestoneDate} onChange={e => setAssignForm(f => ({ ...f, nextMilestoneDate: e.target.value }))}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[#0A2540] mb-1">Next Milestone Description</label>
                    <input value={assignForm.nextMilestone} onChange={e => setAssignForm(f => ({ ...f, nextMilestone: e.target.value }))}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                  </div>
                  {assignError && (
                    <div className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{assignError}</div>
                  )}
                  <div className="sm:col-span-2 flex gap-3">
                    <button type="submit" disabled={assigning} className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                      {assigning ? "Assigning…" : "Assign Service"}
                    </button>
                    <button type="button" onClick={() => { setShowAssign(false); setAssignError(""); }}
                      className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors">Cancel</button>
                  </div>
                </form>
              </div>
            )}

            {/* Workflow builder panel */}
            {showWorkflow && (
              <WorkflowBuilder service={selected} onClose={() => setShowWorkflow(false)} />
            )}

            {/* Edit form + live preview side by side */}
            <div className="flex gap-6 items-start">
              <div className="flex-1 min-w-0">
            <form onSubmit={handleSave}>
              <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Name <span className="text-red-500">*</span></label>
                  <input type="text" value={form.name ?? ""} required
                    onChange={e => setField("name", e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Slug</label>
                  <input type="text" value={form.slug ?? ""}
                    onChange={e => setField("slug", e.target.value.toLowerCase().replace(/\s+/g, "-") || null)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                    placeholder="url-friendly-slug" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Category</label>
                  <input type="text" value={form.category ?? ""}
                    onChange={e => setField("category", e.target.value || null)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Description</label>
                  <textarea value={form.description ?? ""} rows={3}
                    onChange={e => setField("description", e.target.value || null)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Deliverables</label>
                  <textarea value={form.deliverables ?? ""} rows={3}
                    onChange={e => setField("deliverables", e.target.value || null)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                    placeholder="One per line…" />
                </div>

                {/* Pricing */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Fixed Price ($)</label>
                    <input type="number" value={form.price ?? ""} min="0" step="0.01"
                      onChange={e => setField("price", e.target.value || null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Base Price ($)</label>
                    <input type="number" value={form.basePrice ?? ""} min="0" step="0.01"
                      onChange={e => setField("basePrice", e.target.value || null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                      placeholder="Range min" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Max Price ($)</label>
                    <input type="number" value={form.maxPrice ?? ""} min="0" step="0.01"
                      onChange={e => setField("maxPrice", e.target.value || null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                      placeholder="Range max" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Duration (days)</label>
                    <input type="number" value={form.durationDays ?? ""} min="1"
                      onChange={e => setField("durationDays", e.target.value ? parseInt(e.target.value) : null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Turnaround</label>
                    <input type="text" value={form.turnaround ?? ""}
                      onChange={e => setField("turnaround", e.target.value || null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                      placeholder="e.g. 5 business days" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Billing Type</label>
                  <div className="flex gap-3">
                    {[
                      { value: "one_time", label: "One-time charge" },
                      { value: "recurring_monthly", label: "Monthly retainer" },
                    ].map(opt => (
                      <label key={opt.value} className={`flex items-center gap-2.5 flex-1 border rounded-xl p-3 cursor-pointer transition-all ${form.billingType === opt.value ? "border-[#0078D4] bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                        <input type="radio" name="billingType" value={opt.value}
                          checked={form.billingType === opt.value}
                          onChange={() => setField("billingType", opt.value)}
                          className="text-[#0078D4]" />
                        <div>
                          <p className="text-sm font-medium text-[#0A2540]">{opt.label}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="isPublic" checked={form.isPublic ?? true}
                    onChange={e => setField("isPublic", e.target.checked)}
                    className="rounded" />
                  <label htmlFor="isPublic" className="text-sm font-medium text-gray-700">Visible on public site</label>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Marketing Fields</p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Service Type</label>
                      <select value={form.serviceType ?? ""}
                        onChange={e => setField("serviceType", e.target.value || null)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]">
                        <option value="">— none —</option>
                        <option value="micro_offer">micro_offer</option>
                        <option value="retainer">retainer</option>
                        <option value="service_area">service_area</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Tagline</label>
                      <input type="text" value={form.tagline ?? ""}
                        onChange={e => setField("tagline", e.target.value || null)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Target Audience</label>
                      <textarea value={form.targetAudience ?? ""} rows={2}
                        onChange={e => setField("targetAudience", e.target.value || null)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Inclusions (one per line)</label>
                      <textarea value={(form.inclusions ?? []).join("\n")} rows={5}
                        onChange={e => setField("inclusions", e.target.value ? e.target.value.split("\n").filter(Boolean) : null)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Features (one per line)</label>
                      <textarea value={(form.features ?? []).join("\n")} rows={5}
                        onChange={e => setField("features", e.target.value ? e.target.value.split("\n").filter(Boolean) : null)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Badge</label>
                        <input type="text" value={form.badge ?? ""}
                          onChange={e => setField("badge", e.target.value || null)}
                          placeholder="e.g. Most requested"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Hours/Month</label>
                        <input type="text" value={form.hoursPerMonth ?? ""}
                          onChange={e => setField("hoursPerMonth", e.target.value || null)}
                          placeholder="e.g. 10 hours"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Icon Name</label>
                        <input type="text" value={form.iconName ?? ""}
                          onChange={e => setField("iconName", e.target.value || null)}
                          placeholder="e.g. Cloud, Bot, Shield…"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Sort Order</label>
                        <input type="number" value={form.sortOrder ?? 0} min="0"
                          onChange={e => setField("sortOrder", parseInt(e.target.value) || 0)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Page Href</label>
                      <input type="text" value={form.pageHref ?? ""}
                        onChange={e => setField("pageHref", e.target.value || null)}
                        placeholder="e.g. /services/microsoft-365"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                    </div>
                    <div className="flex items-center gap-3">
                      <input type="checkbox" id="highlighted" checked={form.highlighted ?? false}
                        onChange={e => setField("highlighted", e.target.checked)}
                        className="rounded" />
                      <label htmlFor="highlighted" className="text-sm font-medium text-gray-700">Highlighted (Most Popular)</label>
                    </div>
                  </div>
                </div>
              </div>
              <div className="pt-5 border-t border-gray-100 mt-5">
                <button type="submit" disabled={saving}
                  className="w-full bg-[#0078D4] text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60">
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
              </div>{/* end form column */}

              {/* Live card preview */}
              <div className="w-72 flex-shrink-0 sticky top-6">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Live Preview</p>
                <OfferCardPreview form={form} />
              </div>
            </div>{/* end two-column flex */}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the service offering. This action cannot be undone.
              If any client has this service active, the delete will be blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => { e.preventDefault(); void handleDelete(); }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? "Deleting…" : "Delete Service"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
