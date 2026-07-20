import { useState, useEffect, useCallback, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, FileText, Loader2, Save, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useService, useUpdateService } from "@/hooks/useServices";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ServiceEditorSidePanel from "../ServiceEditorSidePanel";
import { PRODUCT_TYPE_BADGE_COLORS } from "../productTypeBadgeColors";
import {
  detectProductType, PRODUCT_TYPE_CONFIGS, type ProductTypeConfig,
} from "@/lib/productTypeConfig";
import { useRegistryOptions } from "@/hooks/useRegistryOptions";
import { resolveIcon, type FieldContext, type WorkflowTemplateMeta } from "./FieldRenderer";
import SectionCard from "./SectionCard";
import TypePickerDialog from "./TypePickerDialog";
import WorkflowBuilder from "./WorkflowBuilder";
import AssociatedDocumentsEditor, { type AssociatedDocument } from "./AssociatedDocumentsEditor";
import { TYPE_FIELD_COMPONENTS } from "./fields";

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

interface Client { id: number; email: string; name: string | null; company: string | null; }

interface Props {
  id: number | null;
  onClose: () => void;
  onSaved?: (id: number) => void;
  panelMode?: boolean;
  allCategoryPaths?: string[];
}

export default function ServiceEditorShell({ id, onClose, onSaved, panelMode = false, allCategoryPaths = [] }: Props) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const { engines: registryEngines, features: registryFeatures } = useRegistryOptions();
  const isNew = id === null;

  const { data: service, isLoading } = useService(id);
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

  const { handleSubmit, reset, watch, control, formState: { isDirty }, setValue } = useForm<ServiceFormValues>({
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

  if (isNew) {
    return <TypePickerDialog onClose={onClose} onCreated={createdId => onSaved?.(createdId)} panelMode={panelMode} />;
  }

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
  const identitySection = typeConfig.sections.find(s => s.key === "identity")!;
  const catalogSection = typeConfig.sections.find(s => s.key === "catalog")!;
  const TypeFields = TYPE_FIELD_COMPONENTS[productType];
  const Icon = resolveIcon(formWatch.iconName ?? null);

  const sectionProps = { ctx: fieldCtx, getCoreValue, setCoreValue, getTaValue, setTaValue };

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
              <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wide ${PRODUCT_TYPE_BADGE_COLORS[productType] ?? "bg-accent text-muted-foreground border-border"}`}>
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

          {/* Config-driven form sections — identity (shared) → type-specific → catalog (shared) */}
          <form id="service-form" onSubmit={e => void handleSubmit(onSubmit)(e)}>
            <div className="space-y-5">
              <SectionCard section={identitySection} {...sectionProps} />
              <TypeFields {...sectionProps} />
              <SectionCard section={catalogSection} {...sectionProps} />

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
