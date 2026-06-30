import { useState, useEffect, useCallback, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ChevronDown, ChevronUp, Plus, Trash2, Save, Loader2,
  CheckCircle, Clock, Sparkles, Cloud, Bot, Shield, Zap, Server, Users,
  Layout as LayoutIcon, ShieldCheck, Lock, Globe, Settings, FileText,
  BarChart2, Award, Briefcase, Target, Code, Database, Monitor, Cpu,
  BookOpen, MessageSquare, Calendar, Star, Layers, ArrowLeft, type LucideIcon,
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
import type { WizardStep, WizardOption } from "@/hooks/useServices";

function nanoid() { return Math.random().toString(36).slice(2, 10); }

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
  "/services/cloud-migration", "/micro-offers", "/pricing", "/resources",
  /^\/resources\/[^/]+$/, "/contact", "/book", "/privacy", "/admin",
];
const KNOWN_PAGE_HREFS = CONSULTING_SITE_ROUTES.filter((r): r is string => typeof r === "string");

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
  inclusions: z.array(z.string()),
  features: z.array(z.string()),
});

type ServiceFormValues = z.infer<typeof serviceSchema>;

interface WorkflowTemplateMeta { id: number; name: string; }
interface ScriptSetItem { scriptPackageId: string; displayOrder: number; title: string; category: string; tags: string[]; }
interface ScriptPackageMeta { id: string; title: string; category: string; }
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
    <div className="border border-[#0078D4]/30 bg-[#1C2128] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h4 className="text-sm font-bold text-[#E6EDF3]">Order Workflow — {serviceName}</h4>
          <p className="text-xs text-[#7D8590] mt-0.5">Build the questionnaire clients walk through to calculate their final price.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setShowCopyFrom(p => !p); setCopySourceId(""); }} className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${showCopyFrom ? "bg-[#0078D4] text-white border-[#0078D4]" : "border-[#30363D] text-[#7D8590] hover:border-[#0078D4] hover:text-[#0078D4]"}`}>Copy from…</button>
          <button onClick={onClose} className="text-xs text-[#7D8590] hover:text-[#E6EDF3]">Close</button>
        </div>
      </div>
      {showCopyFrom && (
        <div className="bg-[#161B22] border border-border rounded-xl p-4 mb-4 space-y-3">
          <p className="text-xs font-semibold text-[#E6EDF3]">Copy workflow steps from another service</p>
          <select value={copySourceId} onChange={e => setCopySourceId(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[#161B22] text-[#E6EDF3]">
            <option value="">— Select a service —</option>
            {allServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="flex gap-4">
            {(["replace", "append"] as const).map(m => (
              <label key={m} className="flex items-center gap-1.5 text-xs text-[#E6EDF3] cursor-pointer">
                <input type="radio" name="copyMode" value={m} checked={copyMode === m} onChange={() => setCopyMode(m)} />
                {m === "replace" ? "Replace" : "Append"}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => void handleCopyFrom()} disabled={!copySourceId || copying} className="flex items-center gap-1.5 text-xs bg-[#0078D4] text-white px-3 py-1.5 rounded-lg font-medium hover:bg-[#006CBE] disabled:opacity-50">
              {copying ? <Loader2 className="w-3 h-3 animate-spin" /> : null}{copying ? "Copying…" : "Copy steps"}
            </button>
            <button onClick={() => setShowCopyFrom(false)} className="text-xs text-[#7D8590] hover:text-[#E6EDF3] px-2">Cancel</button>
          </div>
        </div>
      )}
      {loading ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[#0078D4]" /></div> : (
        <>
          {steps.length === 0 && <p className="text-sm text-[#7D8590] bg-[#161B22] border border-border rounded-lg px-4 py-3 mb-4">No steps yet. Add a step to create the wizard questionnaire.</p>}
          <div className="space-y-4">
            {steps.map((step, si) => (
              <div key={step.id} className="bg-[#161B22] border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveStep(si, -1)} disabled={si === 0} className="text-[#7D8590] hover:text-[#E6EDF3] disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                    <button onClick={() => moveStep(si, 1)} disabled={si === steps.length - 1} className="text-[#7D8590] hover:text-[#E6EDF3] disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                  </div>
                  <span className="text-xs font-bold text-[#0078D4] bg-[#0078D4]/10 rounded-full w-6 h-6 flex items-center justify-center">{si + 1}</span>
                  <input value={step.title} onChange={e => updateStepTitle(si, e.target.value)} placeholder="Step title" className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm bg-[#1C2128] text-[#E6EDF3] focus:outline-none focus:ring-1 focus:ring-[#0078D4]" />
                  <button onClick={() => removeStep(si)} className="text-red-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="ml-12 mb-3">
                  <textarea value={step.description ?? ""} onChange={e => updateStepDesc(si, e.target.value)} placeholder="Description (optional)" rows={2} className="w-full border border-border rounded-lg px-3 py-1.5 text-xs bg-[#1C2128] text-[#E6EDF3] resize-none focus:outline-none focus:ring-1 focus:ring-[#0078D4]" />
                </div>
                <div className="ml-12 space-y-2">
                  {step.options.map((opt, oi) => (
                    <div key={opt.id} className="grid grid-cols-[1fr_110px_28px] gap-2 items-start">
                      <input value={opt.label} onChange={e => updateOption(si, oi, "label", e.target.value)} placeholder="Option label" className="border border-border rounded-lg px-3 py-1.5 text-xs bg-[#1C2128] text-[#E6EDF3] focus:outline-none focus:ring-1 focus:ring-[#0078D4]" />
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#7D8590]">+$</span>
                        <input type="number" min="0" step="1" value={opt.priceAdjustment} onChange={e => updateOption(si, oi, "priceAdjustment", parseFloat(e.target.value) || 0)} className="w-full border border-border rounded-lg pl-7 pr-3 py-1.5 text-xs bg-[#1C2128] text-[#E6EDF3] focus:outline-none focus:ring-1 focus:ring-[#0078D4]" />
                      </div>
                      <button onClick={() => removeOption(si, oi)} className="text-red-400 h-[30px] flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => addOption(si)} className="flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] hover:text-[#58A6FF] transition-colors mt-1"><Plus className="w-3 h-3" />Add option</button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={addStep} className="flex items-center gap-2 border border-dashed border-[#0078D4]/50 text-[#0078D4] text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/5"><Plus className="w-3.5 h-3.5" />Add step</button>
            <button onClick={() => void handleSave()} disabled={saving} className="flex items-center gap-2 bg-[#0078D4] text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{saving ? "Saving…" : "Save Workflow"}
            </button>
            {savedMsg && <span className="text-xs text-emerald-400 font-semibold">✓ Saved</span>}
            {saveError && <span className="text-xs text-red-400">{saveError}</span>}
          </div>
        </>
      )}
    </div>
  );
}

interface Props {
  id: number | null;
  onClose: () => void;
  onSaved?: (id: number) => void;
}

export default function ServiceEditor({ id, onClose, onSaved }: Props) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const isNew = id === null;

  const { data: service, isLoading } = useService(id);
  const createService = useCreateService();
  const updateService = useUpdateService();

  const [clients, setClients] = useState<Client[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateMeta[]>([]);
  const [scriptSets, setScriptSets] = useState<ScriptSetItem[]>([]);
  const [allPackages, setAllPackages] = useState<ScriptPackageMeta[]>([]);
  const [scriptSetAddId, setScriptSetAddId] = useState("");
  const [scriptSetSaving, setScriptSetSaving] = useState(false);

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

  // New service creation state
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createBilling, setCreateBilling] = useState<"one_time" | "recurring_monthly">("one_time");
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
    billingType: service?.billingType ?? "one_time",
    visibility: service?.visibility ?? "private",
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
    inclusions: service?.inclusions ?? [],
    features: service?.features ?? [],
  }), [service]);

  const { register, handleSubmit, control, watch, reset, formState: { errors, isDirty } } = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues,
  });

  useEffect(() => { if (service) reset(defaultValues); }, [service, reset, defaultValues]);

  const formWatch = watch();

  useEffect(() => {
    void (async () => {
      const [cr, wr] = await Promise.all([
        fetchWithAuth("/api/admin/clients"),
        fetchWithAuth("/api/admin/workflow-templates"),
      ]);
      if (cr.ok) setClients(await cr.json() as Client[]);
      if (wr.ok) setWorkflowTemplates(await wr.json() as WorkflowTemplateMeta[]);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const [sr, pr] = await Promise.all([
          fetchWithAuth(`/api/admin/services/${id}/script-sets`),
          fetchWithAuth("/api/admin/ps-scripts/packages"),
        ]);
        if (sr.ok) setScriptSets(await sr.json() as ScriptSetItem[]);
        if (pr.ok) {
          const d = await pr.json() as { id: string; title: string; category: string }[];
          setAllPackages(d.map(p => ({ id: p.id, title: p.title, category: p.category })));
        }
      } catch { /* ignore */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const created = await createService.mutateAsync({
        name: createName.trim(),
        slug: createSlug.trim() || createName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
        billingType: createBilling,
      });
      toast({ title: "Service created" });
      onSaved?.(created.id);
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally { setCreating(false); }
  }, [createName, createSlug, createBilling, createService, toast, onSaved]);

  const onSubmit = useCallback(async (values: ServiceFormValues) => {
    if (!id) return;
    try {
      await updateService.mutateAsync({
        id,
        data: {
          ...values,
          isPublic: values.visibility === "public",
          deliverables: values.deliverables.length > 0 ? values.deliverables : null,
          inclusions: values.inclusions.length > 0 ? values.inclusions : null,
          features: values.features.length > 0 ? values.features : null,
        },
      });
      toast({ title: "Service saved" });
      reset(values);
      onSaved?.(id);
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    }
  }, [id, updateService, toast, reset, onSaved]);

  const handleSaveAndClose = useCallback(async () => {
    await handleSubmit(async (values) => { await onSubmit(values); onClose(); })();
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

  const handleScriptSetAdd = async () => {
    if (!id || !scriptSetAddId) return;
    setScriptSetSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/services/${id}/script-sets`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptPackageId: scriptSetAddId }),
      });
      if (res.ok) { setScriptSets(await res.json() as ScriptSetItem[]); setScriptSetAddId(""); }
      else toast({ title: "Failed to add script set", variant: "destructive" });
    } finally { setScriptSetSaving(false); }
  };

  const handleScriptSetRemove = async (scriptPackageId: string) => {
    if (!id) return;
    const res = await fetchWithAuth(`/api/admin/services/${id}/script-sets/${scriptPackageId}`, { method: "DELETE" });
    if (res.ok) setScriptSets(prev => prev.filter(s => s.scriptPackageId !== scriptPackageId));
    else toast({ title: "Failed to remove script set", variant: "destructive" });
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

  const PageHrefIcon = ({ href }: { href: string | null }) => {
    const v = validatePageHref(href);
    if (v === "no-slash") return <span className="text-amber-400">⚠</span>;
    if (v === "unknown") return <span className="text-amber-400">⚠</span>;
    return null;
  };

  const previewIcon = resolveIcon(formWatch.iconName ?? null);
  const Icon = previewIcon;

  // ---- New service creation form ----
  if (isNew) {
    return (
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 max-w-xl">
          <div className="flex items-center gap-3 mb-6">
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-xl font-bold text-[#E6EDF3]">New Service</h2>
          </div>
          <form onSubmit={e => void handleCreate(e)} className="bg-[#161B22] rounded-xl border border-[#30363D] p-6 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Name <span className="text-red-500">*</span></label>
              <input type="text" required autoFocus value={createName} onChange={e => {
                const name = e.target.value;
                setCreateName(name);
                setCreateSlug(prev => prev || name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
              }} placeholder="e.g. Microsoft 365 Audit"
                className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Slug <span className="text-red-500">*</span></label>
              <input type="text" required value={createSlug}
                onChange={e => setCreateSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))}
                placeholder="url-friendly-slug"
                className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm font-mono bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#7D8590] mb-2 uppercase tracking-wide">Billing Type</label>
              <div className="flex gap-3">
                {[{ v: "one_time" as const, label: "One-time charge" }, { v: "recurring_monthly" as const, label: "Monthly retainer" }].map(opt => (
                  <label key={opt.v} className={`flex items-center gap-2.5 flex-1 border rounded-xl p-3 cursor-pointer transition-all ${createBilling === opt.v ? "border-[#0078D4] bg-[#0078D4]/10" : "border-[#30363D] hover:border-[#484F58]"}`}>
                    <input type="radio" name="createBilling" value={opt.v} checked={createBilling === opt.v} onChange={() => setCreateBilling(opt.v)} className="text-[#0078D4]" />
                    <span className="text-sm font-medium text-[#E6EDF3]">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-xs text-[#7D8590]">Visibility defaults to <strong className="text-[#E6EDF3]">Private</strong>. You can change it after saving.</p>
            <button type="submit" disabled={creating || !createName.trim()}
              className="w-full bg-[#0078D4] text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60">
              {creating ? "Creating…" : "Create Service"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---- Edit form ----
  if (isLoading || !service) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#0078D4]" />
      </div>
    );
  }

  const saving = updateService.isPending;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[#30363D] bg-[#161B22] flex-shrink-0">
          <button type="button" onClick={() => isDirty ? setDiscardOpen(true) : onClose()}
            className="p-1.5 rounded-lg text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-[#E6EDF3] truncate">{service.name}</h2>
              {isDirty && (
                <span className="flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 uppercase tracking-wide">
                  Unsaved
                </span>
              )}
            </div>
            {service.slug && <p className="text-xs font-mono text-[#484F58]">{service.slug}</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button type="button" onClick={() => { reset(defaultValues); }}
              disabled={!isDirty || saving}
              className="px-3 py-1.5 text-xs font-medium border border-[#30363D] text-[#7D8590] rounded-lg hover:bg-[#1C2128] hover:text-[#E6EDF3] disabled:opacity-40 transition-colors">
              Discard
            </button>
            <button type="button" onClick={() => void handleSaveAndClose()} disabled={saving}
              className="px-3 py-1.5 text-xs font-medium border border-[#30363D] text-[#7D8590] rounded-lg hover:bg-[#1C2128] hover:text-[#E6EDF3] disabled:opacity-40 transition-colors">
              {saving ? "Saving…" : "Save & Close"}
            </button>
            <button type="button" onClick={() => void handleSubmit(onSubmit)()} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#0078D4] hover:bg-[#006CBE] text-white rounded-lg disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 px-6 py-2.5 border-b border-[#30363D] bg-[#0D1117] flex-shrink-0 flex-wrap">
          <button type="button" onClick={() => { setShowAssign(p => !p); setShowWorkflow(false); setAssignForm(f => ({ ...f, serviceId: String(id) })); }}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${showAssign ? "bg-[#0078D4] text-white border-[#0078D4]" : "border-[#30363D] text-[#7D8590] hover:border-[#0078D4] hover:text-[#0078D4]"}`}>
            Assign to Client
          </button>
          <button type="button" onClick={() => { setShowWorkflow(p => !p); setShowAssign(false); }}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${showWorkflow ? "bg-[#0078D4] text-white border-[#0078D4]" : "border-[#30363D] text-[#7D8590] hover:border-[#0078D4] hover:text-[#0078D4]"}`}>
            {service.orderWorkflow && service.orderWorkflow.length > 0
              ? `Workflow (${service.orderWorkflow.length} step${service.orderWorkflow.length !== 1 ? "s" : ""})`
              : "Workflow"}
          </button>
          <div className="flex items-center gap-1.5 ml-auto">
            <button type="button" onClick={() => void handleGeneratePdf()} disabled={generatingPdf}
              className="flex items-center gap-1.5 text-xs border border-[#30363D] text-[#7D8590] px-3 py-1.5 rounded-lg hover:bg-[#1C2128] hover:text-[#E6EDF3] disabled:opacity-50 transition-colors">
              {generatingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {generatingPdf ? "Generating…" : "Gen PDF"}
            </button>
            {service.overviewPdfKey && (
              <button type="button" onClick={() => void handleViewPdf()}
                className="text-xs border border-[#30363D] text-[#7D8590] px-3 py-1.5 rounded-lg hover:bg-[#1C2128] hover:text-[#E6EDF3] transition-colors">
                View PDF
              </button>
            )}
            <button type="button" onClick={() => void handleGenerateAllPdfs()} disabled={bulkGenerating}
              className="flex items-center gap-1.5 text-xs border border-[#30363D] text-[#7D8590] px-3 py-1.5 rounded-lg hover:bg-[#1C2128] hover:text-[#E6EDF3] disabled:opacity-50 transition-colors">
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

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Assign panel */}
          {showAssign && (
            <div className="bg-[#1C2128] border border-[#30363D] rounded-xl p-5">
              <h3 className="text-sm font-bold text-[#E6EDF3] mb-4">Assign to Client</h3>
              <form onSubmit={e => void handleAssign(e)} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Client <span className="text-red-500">*</span></label>
                  <select required value={assignForm.clientUserId} onChange={e => setAssignForm(f => ({ ...f, clientUserId: e.target.value }))} className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#161B22] text-[#E6EDF3]">
                    <option value="">— Select Client —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name ?? c.email}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Start Date</label>
                  <input type="date" value={assignForm.startDate} onChange={e => setAssignForm(f => ({ ...f, startDate: e.target.value }))} className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#1C2128] text-[#E6EDF3]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Next Milestone Date</label>
                  <input type="date" value={assignForm.nextMilestoneDate} onChange={e => setAssignForm(f => ({ ...f, nextMilestoneDate: e.target.value }))} className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#1C2128] text-[#E6EDF3]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Milestone Description</label>
                  <input value={assignForm.nextMilestone} onChange={e => setAssignForm(f => ({ ...f, nextMilestone: e.target.value }))} className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#1C2128] text-[#E6EDF3]" />
                </div>
                {assignError && <div className="sm:col-span-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{assignError}</div>}
                <div className="sm:col-span-2 flex gap-3">
                  <button type="submit" disabled={assigning} className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">{assigning ? "Assigning…" : "Assign Service"}</button>
                  <button type="button" onClick={() => { setShowAssign(false); setAssignError(""); }} className="border border-[#30363D] text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#1C2128] transition-colors text-[#7D8590]">Cancel</button>
                </div>
              </form>
            </div>
          )}

          {/* Workflow builder */}
          {showWorkflow && (
            <WorkflowBuilder serviceId={id} serviceName={service.name} onClose={() => setShowWorkflow(false)} />
          )}

          {/* Main form */}
          <form id="service-form" onSubmit={e => void handleSubmit(onSubmit)(e)}>
            <div className="bg-[#161B22] rounded-xl border border-[#30363D] p-6 space-y-5">
              {/* Core fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Name <span className="text-red-500">*</span></label>
                  <input {...register("name")} className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                  {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name.message}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Slug</label>
                  <input {...register("slug")} placeholder="url-friendly-slug" className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm font-mono bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Category</label>
                  <input {...register("category")} className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Tagline</label>
                  <input {...register("tagline")} className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Description</label>
                <textarea {...register("description")} rows={3} className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
              </div>

              {/* Pricing */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Fixed Price ($)</label>
                  <input {...register("price")} type="number" min="0" step="0.01" className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Base Price ($)</label>
                  <input {...register("basePrice")} type="number" min="0" step="0.01" placeholder="Range min" className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Max Price ($)</label>
                  <input {...register("maxPrice")} type="number" min="0" step="0.01" placeholder="Range max" className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Duration (days)</label>
                  <input {...register("durationDays", { setValueAs: v => v === "" || v === null ? null : Number(v) })} type="number" min="1" className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Turnaround</label>
                  <input {...register("turnaround")} placeholder="e.g. 5 business days" className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
              </div>

              {/* Billing type */}
              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-2 uppercase tracking-wide">Billing Type</label>
                <Controller name="billingType" control={control} render={({ field }) => (
                  <div className="flex gap-3">
                    {[{ v: "one_time" as const, label: "One-time charge" }, { v: "recurring_monthly" as const, label: "Monthly retainer" }].map(opt => (
                      <label key={opt.v} className={`flex items-center gap-2.5 flex-1 border rounded-xl p-3 cursor-pointer transition-all ${field.value === opt.v ? "border-[#0078D4] bg-[#0078D4]/10" : "border-[#30363D] hover:border-[#484F58]"}`}>
                        <input type="radio" value={opt.v} checked={field.value === opt.v} onChange={() => field.onChange(opt.v)} className="text-[#0078D4]" />
                        <span className="text-sm font-medium text-[#E6EDF3]">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                )} />
              </div>

              {/* Visibility */}
              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-2 uppercase tracking-wide">Visibility</label>
                <Controller name="visibility" control={control} render={({ field }) => (
                  <div className="flex gap-2">
                    {([
                      { v: "public" as const, label: "Public", hint: "Listed on site" },
                      { v: "private" as const, label: "Private", hint: "Admin only" },
                      { v: "landing_page_only" as const, label: "LP Only", hint: "Via landing page" },
                    ]).map(opt => (
                      <label key={opt.v} className={`flex flex-col flex-1 border rounded-xl p-2.5 cursor-pointer transition-all text-center ${field.value === opt.v ? "border-[#0078D4] bg-[#0078D4]/10" : "border-[#30363D] hover:border-[#484F58]"}`}>
                        <input type="radio" value={opt.v} checked={field.value === opt.v} onChange={() => field.onChange(opt.v)} className="sr-only" />
                        <span className="text-xs font-bold text-[#E6EDF3]">{opt.label}</span>
                        <span className="text-[10px] text-[#7D8590] mt-0.5">{opt.hint}</span>
                      </label>
                    ))}
                  </div>
                )} />
              </div>

              {/* Workflow template */}
              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Linked Workflow Template</label>
                <Controller name="workflowTemplateId" control={control} render={({ field }) => (
                  <select value={field.value ?? ""} onChange={e => field.onChange(e.target.value ? Number(e.target.value) : null)}
                    className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]">
                    <option value="">— None —</option>
                    {workflowTemplates.map(wf => <option key={wf.id} value={wf.id}>{wf.name}</option>)}
                  </select>
                )} />
                <p className="mt-1 text-xs text-[#7D8590]">When a client activates this service, these workflow steps are seeded automatically.</p>
              </div>

              {/* Deliverables */}
              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-2 uppercase tracking-wide">Deliverables</label>
                <Controller name="deliverables" control={control} render={({ field }) => (
                  <ArrayEditor value={field.value} onChange={field.onChange} placeholder="Add a deliverable…" />
                )} />
              </div>
            </div>

            {/* Marketing fields */}
            <div className="bg-[#161B22] rounded-xl border border-[#30363D] p-6 space-y-5 mt-5">
              <p className="text-xs font-bold text-[#7D8590] uppercase tracking-wider">Marketing Fields</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Service Type</label>
                  <select {...register("serviceType")} className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]">
                    <option value="">— none —</option>
                    <option value="micro_offer">micro_offer</option>
                    <option value="retainer">retainer</option>
                    <option value="service_area">service_area</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Service Tier</label>
                  <select {...register("tier")} className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]">
                    <option value="">— none —</option>
                    <option value="entry">Entry Tier</option>
                    <option value="core">Core Tier</option>
                    <option value="strategic">Strategic Tier</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Target Audience</label>
                <textarea {...register("targetAudience")} rows={2} className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-2 uppercase tracking-wide">Inclusions</label>
                <Controller name="inclusions" control={control} render={({ field }) => (
                  <ArrayEditor value={field.value} onChange={field.onChange} placeholder="Add an inclusion…" />
                )} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-2 uppercase tracking-wide">Features</label>
                <Controller name="features" control={control} render={({ field }) => (
                  <ArrayEditor value={field.value} onChange={field.onChange} placeholder="Add a feature…" />
                )} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Badge</label>
                  <input {...register("badge")} placeholder="e.g. Most requested" className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Hours / Month</label>
                  <input {...register("hoursPerMonth")} placeholder="e.g. 10 hours" className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Icon</label>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-[#0078D4]" />
                    </div>
                    <select {...register("iconName")} className="flex-1 border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]">
                      <option value="">— Default (Sparkles) —</option>
                      {ICON_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Sort Order</label>
                  <input {...register("sortOrder", { setValueAs: v => Number(v) || 0 })} type="number" min="0" className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Page Href</label>
                <div className="relative">
                  <input
                    {...register("pageHref")}
                    list="service-page-hrefs"
                    placeholder="e.g. /services/microsoft-365"
                    className={`w-full border rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4] pr-8 ${(() => { const v = validatePageHref(formWatch.pageHref); return v === "no-slash" || v === "unknown" ? "border-amber-400" : "border-[#30363D]"; })()}`}
                  />
                  <datalist id="service-page-hrefs">{KNOWN_PAGE_HREFS.map(p => <option key={p} value={p} />)}</datalist>
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    <PageHrefIcon href={formWatch.pageHref ?? null} />
                  </div>
                </div>
                {validatePageHref(formWatch.pageHref) === "no-slash" && (
                  <p className="mt-1 text-xs text-amber-500">⚠ Must start with /</p>
                )}
                {validatePageHref(formWatch.pageHref) === "unknown" && (
                  <p className="mt-1 text-xs text-amber-500">⚠ Path not found on consulting site</p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <input {...register("highlighted")} type="checkbox" id="highlighted-edit" className="rounded border-[#30363D] text-[#0078D4] bg-[#0D1117]" />
                <label htmlFor="highlighted-edit" className="text-sm font-medium text-[#C9D1D9] cursor-pointer">Highlighted (Most Popular)</label>
              </div>
            </div>

            {/* Script Sets */}
            <div className="bg-[#161B22] rounded-xl border border-[#30363D] p-6 mt-5">
              <p className="text-xs font-bold text-[#7D8590] uppercase tracking-wider mb-1">Script Sets</p>
              <p className="text-xs text-[#7D8590] mb-3">Script packages automatically run for clients of this service.</p>
              {scriptSets.length > 0 ? (
                <div className="space-y-1.5 mb-3">
                  {scriptSets.map(ss => (
                    <div key={ss.scriptPackageId} className="flex items-center justify-between gap-2 bg-[#1C2128] border border-[#30363D] rounded-lg px-3 py-2">
                      <div>
                        <p className="text-xs font-medium text-[#E6EDF3]">{ss.title}</p>
                        <p className="text-[10px] text-[#7D8590]">{ss.category}</p>
                      </div>
                      <button type="button" onClick={() => void handleScriptSetRemove(ss.scriptPackageId)} className="text-[#484F58] hover:text-red-400 transition-colors flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-[#7D8590] mb-3">No script sets linked.</p>}
              <div className="flex gap-2">
                <select value={scriptSetAddId} onChange={e => setScriptSetAddId(e.target.value)} className="flex-1 border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#0D1117] text-[#E6EDF3]">
                  <option value="">— Add script package —</option>
                  {allPackages.filter(p => !scriptSets.find(s => s.scriptPackageId === p.id)).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
                <button type="button" onClick={() => void handleScriptSetAdd()} disabled={!scriptSetAddId || scriptSetSaving}
                  className="flex items-center gap-1.5 text-xs bg-[#0078D4] text-white px-3 py-2 rounded-lg hover:bg-[#006CBE] disabled:opacity-50 transition-colors">
                  {scriptSetSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}Add
                </button>
              </div>
            </div>

            {/* Offer card preview */}
            <div className="bg-[#161B22] rounded-xl border border-[#30363D] p-6 mt-5">
              <p className="text-xs font-bold text-[#7D8590] uppercase tracking-wider mb-4">Card Preview</p>
              <div className="max-w-sm">
                <div className="bg-[#1C2128] rounded-xl border border-[#30363D] p-5 flex flex-col shadow-sm">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-[#0078D4]" />
                    </div>
                    {formWatch.badge && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#0078D4]/10 text-[#0078D4]">{formWatch.badge}</span>}
                  </div>
                  {formWatch.category && <p className="text-xs text-[#7D8590] uppercase tracking-wider mb-1">{formWatch.category}</p>}
                  <p className="text-[#0078D4] text-2xl font-extrabold mb-0.5">
                    {(formWatch.basePrice && formWatch.maxPrice) ? `$${parseFloat(formWatch.basePrice).toLocaleString()}–$${parseFloat(formWatch.maxPrice).toLocaleString()}` :
                      formWatch.price ? `$${parseFloat(formWatch.price).toLocaleString()}` : "Contact for pricing"}
                  </p>
                  <h3 className="text-base font-bold text-[#E6EDF3] mb-1">{formWatch.name || <span className="text-[#484F58]">Untitled Service</span>}</h3>
                  {formWatch.tagline && <p className="text-xs italic text-[#7D8590] mb-2">{formWatch.tagline}</p>}
                  {formWatch.description && <p className="text-xs text-[#C9D1D9] leading-relaxed mb-3">{formWatch.description}</p>}
                  {(formWatch.inclusions ?? []).length > 0 && (
                    <ul className="space-y-1 mb-3">
                      {(formWatch.inclusions ?? []).slice(0, 4).map((item, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-[#C9D1D9]">
                          <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0 mt-0.5" />{item}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="w-full bg-[#0078D4]/70 text-white text-xs font-semibold text-center py-2 rounded-lg mt-2 opacity-70">Get Started</div>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Right side panel */}
      <ServiceEditorSidePanel form={formWatch} isNew={false} isDirty={isDirty} />

      {/* Discard confirmation */}
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent className="bg-[#161B22] border-[#30363D]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#E6EDF3]">Discard changes?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#7D8590]">
              You have unsaved changes. Going back will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#30363D] text-[#7D8590] hover:bg-[#1C2128]">Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={onClose} className="bg-red-600 hover:bg-red-700 text-white border-0">Discard & go back</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
