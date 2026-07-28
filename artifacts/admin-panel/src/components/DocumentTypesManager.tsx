import { useCallback, useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { FileCog, Plus, Pencil, Loader2, X, SlidersHorizontal, Sparkles } from "lucide-react";
import PromptEditDialog from "@/components/PromptEditDialog";
import DocumentTypePreviewDialog from "@/components/DocumentTypePreviewDialog";
import DocumentScopingEditor from "@/components/DocumentScopingEditor";

// Section builder and scoping builder (includedProfileKeyPatterns /
// includedSignalCategories) are covered here. The linked AI prompt (set at
// creation time server-side) is editable via the shared PromptEditDialog,
// not reassignable through this form.

interface DocumentType {
  id: number;
  key: string;
  label: string;
  category: "report" | "consulting";
  serviceId: number | null;
  pipelineCategory: "standalone" | "pipeline_output";
  sortOrder: number;
  isActive: boolean;
  sections: { id: string; heading: string; guidance: string }[];
  includedProfileKeyPatterns: string[];
  includedSignalCategories: string[];
  aiPromptId: number | null;
}

// No dedicated lightweight services-lookup endpoint exists yet — reusing the
// full GET /api/admin/services list (already used elsewhere in the admin
// panel, e.g. useServices.ts) and picking only {id, name} out of it. A
// purpose-built lightweight lookup endpoint may be worth adding as a
// follow-up, but building a new backend route is out of scope for this task.
interface ServiceOption {
  id: number;
  name: string;
}

const inputCls =
  "w-full border border-border bg-background text-foreground rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60";
const selectCls = inputCls;
const btnPrimaryCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors";
const btnGhostCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-xs font-semibold rounded-lg border border-border hover:border-primary/40 disabled:opacity-40 transition-colors";

interface TypeForm {
  key: string;
  label: string;
  category: "report" | "consulting";
  serviceId: string;
  pipelineCategory: "standalone" | "pipeline_output";
  sortOrder: string;
  isActive: boolean;
  sectionsRaw: string;
  profileKeyPatterns: string[];
  signalCategories: string[];
}

const emptyTypeForm = (): TypeForm => ({
  key: "",
  label: "",
  category: "report",
  serviceId: "",
  pipelineCategory: "standalone",
  sortOrder: "0",
  isActive: true,
  sectionsRaw: "[]",
  profileKeyPatterns: [],
  signalCategories: [],
});

async function readErr(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body as { error?: string } | null)?.error ?? fallback;
}

export default function DocumentTypesManager() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [typesRes, servicesRes] = await Promise.all([
        fetchWithAuth("/api/admin/document-types"),
        fetchWithAuth("/api/admin/services"),
      ]);
      if (typesRes.ok) setTypes((await typesRes.json()) as DocumentType[]);
      if (servicesRes.ok) {
        const rows = (await servicesRes.json()) as { id: number; name: string }[];
        setServices(rows.map(r => ({ id: r.id, name: r.name })));
      }
    } catch {
      toast({ title: "Failed to load document types" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingType, setEditingType] = useState<DocumentType | null>(null);
  const [form, setForm] = useState<TypeForm>(emptyTypeForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [promptDialogKey, setPromptDialogKey] = useState<string | null>(null);
  const [promptDialogLoading, setPromptDialogLoading] = useState(false);

  const [previewData, setPreviewData] = useState<{ docTypeLabel: string; preview: any } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const openPromptDialog = async (type: DocumentType) => {
    if (type.aiPromptId == null) {
      toast({ title: "No linked prompt", description: "This document type has no linked AI prompt.", variant: "destructive" });
      return;
    }
    setPromptDialogLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/ai-prompts/${type.aiPromptId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load prompt");
      setPromptDialogKey(data.prompt.key);
    } catch (err) {
      toast({ title: "Failed to load prompt", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setPromptDialogLoading(false);
    }
  };

  const openPreview = async (type: DocumentType) => {
    const clientUserIdInput = window.prompt("Enter a real client user ID to preview against (use a testbed customer):");
    if (!clientUserIdInput) return;
    const clientUserId = parseInt(clientUserIdInput, 10);
    if (isNaN(clientUserId)) {
      toast({ title: "Invalid input", description: "Must be a numeric user ID.", variant: "destructive" });
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/document-types/${encodeURIComponent(type.key)}/preview?clientUserId=${clientUserId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreviewData({ docTypeLabel: type.label, preview: data.preview });
    } catch (err) {
      toast({ title: "Preview failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const openCreate = () => {
    setEditingType(null);
    setForm(emptyTypeForm());
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (type: DocumentType) => {
    setEditingType(type);
    setForm({
      key: type.key,
      label: type.label,
      category: type.category,
      serviceId: type.serviceId != null ? String(type.serviceId) : "",
      pipelineCategory: type.pipelineCategory,
      sortOrder: String(type.sortOrder),
      isActive: type.isActive,
      sectionsRaw: JSON.stringify(type.sections ?? [], null, 2),
      profileKeyPatterns: type.includedProfileKeyPatterns ?? [],
      signalCategories: type.includedSignalCategories ?? [],
    });
    setFormError(null);
    setModalOpen(true);
  };

  const submitForm = async () => {
    if (!form.key.trim() || !form.label.trim()) {
      setFormError("Key and label are required");
      return;
    }
    if (!editingType && !/^[a-z0-9_]+$/.test(form.key.trim())) {
      setFormError("Key must be lowercase letters, digits, or underscores only");
      return;
    }
    let parsedSections: { id: string; heading: string; guidance: string }[];
    try {
      const parsed = JSON.parse(form.sectionsRaw);
      if (!Array.isArray(parsed)) throw new Error("Sections must be a JSON array");
      for (const s of parsed) {
        if (typeof s !== "object" || s === null || typeof s.id !== "string" || typeof s.heading !== "string" || typeof s.guidance !== "string") {
          throw new Error("Each section must have string id, heading, and guidance fields");
        }
      }
      parsedSections = parsed as { id: string; heading: string; guidance: string }[];
    } catch (err) {
      setFormError(err instanceof Error ? `Sections JSON error: ${err.message}` : "Invalid sections JSON");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const body: Record<string, unknown> = {
        label: form.label.trim(),
        serviceId: form.serviceId.trim() !== "" ? Number(form.serviceId) : null,
        pipelineCategory: form.pipelineCategory,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
        sections: parsedSections,
        includedProfileKeyPatterns: form.profileKeyPatterns,
        includedSignalCategories: form.signalCategories,
      };

      const res = editingType
        ? await fetchWithAuth(`/api/admin/document-types/${encodeURIComponent(editingType.key)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetchWithAuth("/api/admin/document-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: form.key.trim(), category: form.category, ...body }),
          });
      if (!res.ok) {
        setFormError(await readErr(res, "Failed to save document type"));
        return;
      }
      setModalOpen(false);
      await loadAll();
      toast({ title: editingType ? "Document type updated" : "Document type created" });
    } catch {
      setFormError("Failed to save document type");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (type: DocumentType) => {
    try {
      const res = type.isActive
        ? await fetchWithAuth(`/api/admin/document-types/${encodeURIComponent(type.key)}/deactivate`, { method: "POST" })
        : await fetchWithAuth(`/api/admin/document-types/${encodeURIComponent(type.key)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive: true }),
          });
      if (!res.ok) throw new Error(await readErr(res, "Failed to update document type"));
      await loadAll();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to update document type" });
    }
  };

  const serviceName = (serviceId: number | null) =>
    serviceId == null ? "—" : (services.find(s => s.id === serviceId)?.name ?? `#${serviceId}`);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading document types…
      </div>
    );
  }

  const sortedTypes = [...types].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-foreground text-sm font-semibold flex items-center gap-2">
            <FileCog className="h-4 w-4 text-primary" />
            Document Types
          </h2>
          <p className="text-muted-foreground text-xs mt-1 max-w-2xl">
            The document_types registry driving report/consulting deliverable generation. Section structure, signal
            scoping, and AI prompt editing live elsewhere.
          </p>
        </div>
        <button onClick={openCreate} className={btnPrimaryCls}>
          <Plus className="h-3.5 w-3.5" /> New Document Type
        </button>
      </div>

      {sortedTypes.length === 0 ? (
        <div className="px-4 py-3 text-xs italic text-muted-foreground/70 bg-card border border-border rounded-lg">
          No document types yet.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border/60">
          {sortedTypes.map(type => (
            <div key={type.id} className="flex items-center gap-3 px-4 py-2.5 group">
              <span className="text-[11px] text-muted-foreground/60 shrink-0 w-8">#{type.sortOrder}</span>
              <span className="font-mono text-xs text-foreground/90">{type.key}</span>
              <span className="text-xs text-muted-foreground truncate">{type.label}</span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${
                  type.category === "report"
                    ? "bg-blue-400/10 text-blue-400 border border-blue-400/25"
                    : "bg-purple-400/10 text-purple-400 border border-purple-400/25"
                }`}
              >
                {type.category}
              </span>
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-border text-muted-foreground">
                {type.pipelineCategory}
              </span>
              <span className="text-xs text-muted-foreground/80 shrink-0">{serviceName(type.serviceId)}</span>
              <button
                onClick={() => void toggleActive(type)}
                className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  type.isActive
                    ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/25"
                    : "bg-border text-muted-foreground border border-border"
                }`}
              >
                {type.isActive ? "Active" : "Inactive"}
              </button>
              <button onClick={() => openEdit(type)} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent shrink-0" title="Edit document type">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => void openPromptDialog(type)}
                disabled={promptDialogLoading}
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 disabled:opacity-40"
                title="Edit AI prompt"
              >
                <SlidersHorizontal className="size-3.5" />
              </button>
              <button
                onClick={() => void openPreview(type)}
                disabled={previewLoading}
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 disabled:opacity-40"
                title="Preview scoped data"
              >
                <Sparkles className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{editingType ? "Edit Document Type" : "New Document Type"}</h3>
              <button onClick={() => setModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Key</label>
              <input
                className={inputCls}
                value={form.key}
                disabled={!!editingType}
                onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                placeholder="e.g. security_posture_report"
              />
              <p className="text-[10px] text-muted-foreground/60">Lowercase letters, digits, and underscores only.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Label</label>
              <input className={inputCls} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Security Posture Report" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Category</label>
                <select
                  className={selectCls}
                  value={form.category}
                  disabled={!!editingType}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value as "report" | "consulting" }))}
                >
                  <option value="report">report</option>
                  <option value="consulting">consulting</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Pipeline category</label>
                <select
                  className={selectCls}
                  value={form.pipelineCategory}
                  onChange={e => setForm(f => ({ ...f, pipelineCategory: e.target.value as "standalone" | "pipeline_output" }))}
                >
                  <option value="standalone">standalone</option>
                  <option value="pipeline_output">pipeline_output</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Linked service</label>
              <select className={selectCls} value={form.serviceId} onChange={e => setForm(f => ({ ...f, serviceId: e.target.value }))}>
                <option value="">(none)</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">
                Sections <span className="font-normal text-muted-foreground/60">(JSON array of {"{"}id, heading, guidance{"}"})</span>
              </label>
              <div className="border border-border rounded-md overflow-hidden" style={{ height: "220px" }}>
                <CodeMirror
                  value={form.sectionsRaw}
                  onChange={value => setForm(f => ({ ...f, sectionsRaw: value }))}
                  extensions={[json()]}
                  theme={oneDark}
                  height="100%"
                  style={{ height: "100%", fontSize: "12px" }}
                  basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
                />
              </div>
            </div>

            <DocumentScopingEditor
              profileKeyPatterns={form.profileKeyPatterns}
              onProfileKeyPatternsChange={v => setForm(f => ({ ...f, profileKeyPatterns: v }))}
              signalCategories={form.signalCategories}
              onSignalCategoriesChange={v => setForm(f => ({ ...f, signalCategories: v }))}
            />

            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Sort order</label>
                <input className={inputCls} type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-xs text-foreground/90 pb-1.5">
                <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
                Active
              </label>
            </div>

            {formError && <p className="text-xs text-red-400">{formError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setModalOpen(false)} className={btnGhostCls}>Cancel</button>
              <button onClick={() => void submitForm()} disabled={saving} className={btnPrimaryCls}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingType ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {promptDialogKey && (
        <PromptEditDialog
          open={true}
          onClose={() => setPromptDialogKey(null)}
          promptKey={promptDialogKey}
          fetchWithAuth={fetchWithAuth}
        />
      )}

      {previewData && (
        <DocumentTypePreviewDialog
          onClose={() => setPreviewData(null)}
          docTypeLabel={previewData.docTypeLabel}
          preview={previewData.preview}
        />
      )}
    </div>
  );
}
