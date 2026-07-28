import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { FileText, Eye, Play, Loader2, RefreshCw, ExternalLink, AlertTriangle, Plus, X, Zap } from "lucide-react";
import DocumentTypePreviewDialog from "@/components/DocumentTypePreviewDialog";
import DocumentScopingEditor from "@/components/DocumentScopingEditor";

function slugifyKey(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "type";
}

// Net-new admin surface — zero code, logic, or UI ported from admin-insights.ts /
// InsightsOutputs.tsx / InsightsPayloadDialog.tsx (those are legacy and being
// marked dead in a later phase of this same initiative). Real generation is
// routed through generateDocument()/generateSowDocument() via
// admin-document-generator.ts, keyed off document_types.pipelineCategory.

interface DocumentType {
  id: number;
  key: string;
  label: string;
  category: "report" | "consulting";
  pipelineCategory: "standalone" | "pipeline_output";
  isActive: boolean;
  sortOrder: number;
  aiPromptId: number | null;
  includedProfileKeyPatterns: string[];
  includedSignalCategories: string[];
}

interface TenantOption {
  id: number;
  name: string;
  tenantId: string | null;
  domain: string | null;
  status: string;
}

interface ServiceOption {
  id: number;
  name: string;
}

interface MissingTypeRow {
  id: number;
  name: string;
  description: string | null;
  slug: string | null;
}

interface ProjectOption {
  id: number;
  title: string;
  status: string;
}

interface HistoryRow {
  id: number;
  docType: string;
  docTypeLabel: string | null;
  category: "report" | "consulting";
  title: string;
  status: "draft" | "approved" | "delivered" | "archived" | "generating" | "failed";
  errorMessage: string | null;
  createdAt: string;
  customerId: number | null;
  customerName: string | null;
  customerCompany: string | null;
  projectId: number | null;
  projectTitle: string | null;
}

const STATUS_STYLES: Record<HistoryRow["status"], string> = {
  draft: "bg-gray-500/20 text-gray-300 border-gray-500/30",
  approved: "bg-green-500/20 text-green-300 border-green-500/30",
  delivered: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  archived: "bg-gray-600/20 text-gray-400 border-gray-600/30",
  generating: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  failed: "bg-red-500/20 text-red-300 border-red-500/30",
};

export default function DocumentGeneratorIde() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);

  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  const [generatingKey, setGeneratingKey] = useState<string | null>(null);

  const [previewData, setPreviewData] = useState<{ docTypeLabel: string; preview: any } | null>(null);
  const [previewLoadingKey, setPreviewLoadingKey] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [services, setServices] = useState<ServiceOption[]>([]);
  const [missingTypes, setMissingTypes] = useState<MissingTypeRow[]>([]);
  const [loadingMissingTypes, setLoadingMissingTypes] = useState(true);
  const [quickAddingId, setQuickAddingId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const loadDocTypes = useCallback(async () => {
    setLoadingTypes(true);
    try {
      const res = await fetchWithAuth("/api/admin/document-types");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load document types");
      const rows = (data as DocumentType[]).filter(t => t.isActive);
      setDocTypes(rows);
    } catch (err) {
      toast({ title: "Failed to load document types", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLoadingTypes(false);
    }
  }, [fetchWithAuth, toast]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetchWithAuth("/api/admin/document-generator/history");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load history");
      setHistory(data as HistoryRow[]);
    } catch (err) {
      toast({ title: "Failed to load generation history", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLoadingHistory(false);
    }
  }, [fetchWithAuth, toast]);

  const loadMissingTypes = useCallback(async () => {
    setLoadingMissingTypes(true);
    try {
      const res = await fetchWithAuth("/api/admin/document-generator/missing-types");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load missing document types");
      setMissingTypes(data as MissingTypeRow[]);
    } catch (err) {
      toast({ title: "Failed to load missing document types", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLoadingMissingTypes(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void loadDocTypes(); }, [loadDocTypes]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => { void loadMissingTypes(); }, [loadMissingTypes]);

  useEffect(() => {
    fetchWithAuth("/api/admin/document-generator/tenants")
      .then(r => r.json())
      .then((d: unknown) => setTenants(Array.isArray(d) ? (d as TenantOption[]) : []))
      .catch(() => { /* non-fatal */ });
  }, [fetchWithAuth]);

  useEffect(() => {
    fetchWithAuth("/api/admin/services")
      .then(r => r.json())
      .then((d: unknown) => setServices(Array.isArray(d) ? (d as ServiceOption[]) : []))
      .catch(() => { /* non-fatal */ });
  }, [fetchWithAuth]);

  useEffect(() => {
    if (selectedCustomerId == null) { setProjects([]); setSelectedProjectId(null); return; }
    setSelectedProjectId(null);
    fetchWithAuth(`/api/admin/document-generator/tenants/${selectedCustomerId}/projects`)
      .then(r => r.json())
      .then((d: unknown) => setProjects(Array.isArray(d) ? (d as ProjectOption[]) : []))
      .catch(() => setProjects([]));
  }, [selectedCustomerId, fetchWithAuth]);

  const openPreview = async (type: DocumentType) => {
    if (selectedCustomerId == null) {
      toast({ title: "Select a tenant first", description: "Preview needs a target tenant to scope real data against.", variant: "destructive" });
      return;
    }
    setPreviewLoadingKey(type.key);
    try {
      const qs = new URLSearchParams({ mspCustomerId: String(selectedCustomerId) });
      if (selectedProjectId != null) qs.set("projectId", String(selectedProjectId));
      const res = await fetchWithAuth(`/api/admin/document-types/${encodeURIComponent(type.key)}/preview?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreviewData({ docTypeLabel: type.label, preview: data.preview });
    } catch (err) {
      toast({ title: "Preview failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setPreviewLoadingKey(null);
    }
  };

  const createDocumentType = useCallback(async (payload: {
    label: string;
    key: string;
    category: "report" | "consulting";
    pipelineCategory: "standalone" | "pipeline_output";
    serviceId: number | null;
    includedProfileKeyPatterns: string[];
    includedSignalCategories: string[];
  }) => {
    const res = await fetchWithAuth("/api/admin/document-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to create document type");
    const created = data as DocumentType;
    setDocTypes(prev => [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)));
    return created;
  }, [fetchWithAuth]);

  const quickAdd = async (svc: MissingTypeRow) => {
    setQuickAddingId(svc.id);
    try {
      const key = slugifyKey(svc.slug || svc.name);
      const created = await createDocumentType({
        label: svc.name,
        key,
        category: "report",
        pipelineCategory: "standalone",
        serviceId: svc.id,
        includedProfileKeyPatterns: [],
        includedSignalCategories: [],
      });
      setMissingTypes(prev => prev.filter(m => m.id !== svc.id));
      toast({ title: "Document type created", description: `${svc.name} — key "${created.key}"` });
    } catch (err) {
      toast({ title: "Quick Add failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setQuickAddingId(null);
    }
  };

  const generateNow = async (type: DocumentType) => {
    if (selectedCustomerId == null) {
      toast({ title: "Select a tenant first", description: "Generation needs a target tenant.", variant: "destructive" });
      return;
    }
    setGeneratingKey(type.key);
    try {
      const res = await fetchWithAuth(`/api/admin/document-generator/document-types/${encodeURIComponent(type.key)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mspCustomerId: selectedCustomerId, projectId: selectedProjectId ?? 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      toast({ title: "Document generated", description: `${type.label} — document #${data.documentId}` });
      void loadHistory();
    } catch (err) {
      toast({ title: "Generation failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setGeneratingKey(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background text-white">
      <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><FileText className="w-5 h-5" /> Document Generator</h1>
          <p className="text-gray-400 text-sm mt-0.5">Trigger real document generation from the document_types registry</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedCustomerId ?? ""}
            onChange={e => setSelectedCustomerId(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-card border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            <option value="">Select tenant…</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>{t.tenantId == null ? `⚠ ${t.name} (not yet connected)` : t.name}</option>
            ))}
          </select>
          <select
            value={selectedProjectId ?? ""}
            onChange={e => setSelectedProjectId(e.target.value ? parseInt(e.target.value, 10) : null)}
            disabled={selectedCustomerId == null}
            className="bg-card border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            <option value="">No project</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
          >
            <Plus className="w-4 h-4" /> New Document Type
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {!loadingMissingTypes && missingTypes.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-amber-300 uppercase tracking-wide flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Missing Document Types
              </h2>
              <button onClick={() => void loadMissingTypes()} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
            <p className="text-gray-500 text-xs mb-3">
              Services set up for document-generation delivery with no matching document type yet.
            </p>
            <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg divide-y divide-amber-500/20">
              {missingTypes.map(svc => (
                <div key={svc.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm text-white">{svc.name}</div>
                    {svc.description && (
                      <div className="text-xs text-gray-500 mt-0.5 truncate">{svc.description}</div>
                    )}
                  </div>
                  <button
                    onClick={() => void quickAdd(svc)}
                    disabled={quickAddingId === svc.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 shrink-0"
                  >
                    {quickAddingId === svc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    Quick Add
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wide">Document Types</h2>
          {loadingTypes ? (
            <div className="text-gray-500 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : docTypes.length === 0 ? (
            <div className="text-gray-500 text-sm">No active document types.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {docTypes.map(type => (
                <div key={type.key} className="border border-gray-700/50 rounded-lg p-4 bg-card/40 flex flex-col gap-3">
                  <div>
                    <div className="text-sm font-medium text-white">{type.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                      <span>{type.category}</span>
                      <span className="text-gray-600">·</span>
                      <span className={type.pipelineCategory === "pipeline_output" ? "text-purple-400" : "text-blue-400"}>
                        {type.pipelineCategory === "pipeline_output" ? "SOW pipeline" : "standalone"}
                      </span>
                    </div>
                    {type.includedProfileKeyPatterns.length === 0 && type.includedSignalCategories.length === 0 && (
                      <Link
                        href="/command/insights?tab=document_types"
                        title={`"${type.label}" has no profile key patterns or signal categories set — edit scoping in Document Types`}
                        className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20"
                      >
                        <AlertTriangle className="w-3 h-3" /> Unscoped — sends full profile
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-auto">
                    <button
                      onClick={() => openPreview(type)}
                      disabled={previewLoadingKey === type.key}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-700/50 text-gray-300 hover:bg-gray-800/50 disabled:opacity-50"
                    >
                      {previewLoadingKey === type.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                      Preview
                    </button>
                    <button
                      onClick={() => generateNow(type)}
                      disabled={generatingKey === type.key}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                    >
                      {generatingKey === type.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      Generate Now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Recent Generations</h2>
            <button onClick={() => void loadHistory()} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
          {loadingHistory ? (
            <div className="text-gray-500 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : history.length === 0 ? (
            <div className="text-gray-500 text-sm">No documents generated yet.</div>
          ) : (
            <div className="border border-gray-700/50 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-card/60 text-gray-400 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Document</th>
                    <th className="text-left px-4 py-2 font-medium">Target</th>
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                    <th className="text-left px-4 py-2 font-medium">Generated</th>
                    <th className="text-left px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/30">
                  {history.map(row => (
                    <tr key={row.id} className="hover:bg-gray-800/30">
                      <td className="px-4 py-2 text-white">{row.docTypeLabel ?? row.docType}</td>
                      <td className="px-4 py-2 text-gray-300">
                        {row.customerCompany || row.customerName || (row.customerId != null ? `#${row.customerId}` : "—")}
                        {row.projectTitle && <span className="text-gray-500"> · {row.projectTitle}</span>}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${STATUS_STYLES[row.status]}`}>
                          {row.status === "failed" && <AlertTriangle className="w-3 h-3" />}
                          {row.status}
                        </span>
                        {row.status === "failed" && row.errorMessage && (
                          <div className="text-xs text-red-400/80 mt-1 max-w-xs truncate" title={row.errorMessage}>{row.errorMessage}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-400">{new Date(row.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">
                        <a
                          href={`/api/admin/document-generator/history/${row.id}/html`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                        >
                          View <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {previewData && (
        <DocumentTypePreviewDialog
          docTypeLabel={previewData.docTypeLabel}
          preview={previewData.preview}
          onClose={() => setPreviewData(null)}
        />
      )}

      {showCreateModal && (
        <NewDocumentTypeModal
          services={services}
          onClose={() => setShowCreateModal(false)}
          onCreate={createDocumentType}
        />
      )}
    </div>
  );
}

interface NewDocumentTypeModalProps {
  services: ServiceOption[];
  onClose: () => void;
  onCreate: (payload: {
    label: string;
    key: string;
    category: "report" | "consulting";
    pipelineCategory: "standalone" | "pipeline_output";
    serviceId: number | null;
    includedProfileKeyPatterns: string[];
    includedSignalCategories: string[];
  }) => Promise<DocumentType>;
}

function NewDocumentTypeModal({ services, onClose, onCreate }: NewDocumentTypeModalProps) {
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [category, setCategory] = useState<"report" | "consulting">("report");
  const [pipelineCategory, setPipelineCategory] = useState<"standalone" | "pipeline_output">("standalone");
  const [serviceId, setServiceId] = useState<number | "">("");
  const [profileKeyPatterns, setProfileKeyPatterns] = useState<string[]>([]);
  const [signalCategories, setSignalCategories] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ label: string; aiPromptId: number | null } | null>(null);

  const handleLabelChange = (value: string) => {
    setLabel(value);
    if (!keyTouched) setKey(slugifyKey(value));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !key.trim()) return;
    setError(null);

    setSubmitting(true);
    try {
      const row = await onCreate({
        label: label.trim(),
        key: key.trim(),
        category,
        pipelineCategory,
        serviceId: serviceId === "" ? null : serviceId,
        includedProfileKeyPatterns: profileKeyPatterns,
        includedSignalCategories: signalCategories,
      });
      setCreated({ label: row.label, aiPromptId: row.aiPromptId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative w-full max-w-md bg-background border border-gray-700/50 rounded-xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <Plus className="w-4 h-4 text-blue-400" />
            <div className="text-white font-semibold text-sm">New Document Type</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {created ? (
          <div className="p-5 space-y-4">
            <div className="text-sm text-gray-300">
              <span className="text-white font-medium">{created.label}</span> was created.
            </div>
            {created.aiPromptId != null && (
              <Link
                href={`/prompt-center/${created.aiPromptId}`}
                className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"
              >
                Edit Prompt <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            )}
            <div className="flex justify-end">
              <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white">
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={e => void handleSubmit(e)} className="p-5 space-y-4 overflow-y-auto">
            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>
            )}
            <div>
              <label className="text-xs text-gray-400 block mb-1">Label</label>
              <input
                value={label}
                onChange={e => handleLabelChange(e.target.value)}
                className="w-full bg-card border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-white"
                placeholder="Security Posture Report"
                required
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Key</label>
              <input
                value={key}
                onChange={e => { setKeyTouched(true); setKey(e.target.value); }}
                className="w-full bg-card border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-white font-mono"
                placeholder="security_posture_report"
                pattern="[a-z0-9_]+"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Category</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value as "report" | "consulting")}
                  className="w-full bg-card border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-white"
                >
                  <option value="report">Report</option>
                  <option value="consulting">Consulting</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Pipeline</label>
                <select
                  value={pipelineCategory}
                  onChange={e => setPipelineCategory(e.target.value as "standalone" | "pipeline_output")}
                  className="w-full bg-card border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-white"
                >
                  <option value="standalone">Standalone</option>
                  <option value="pipeline_output">SOW pipeline</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Service (optional)</label>
              <select
                value={serviceId}
                onChange={e => setServiceId(e.target.value ? parseInt(e.target.value, 10) : "")}
                className="w-full bg-card border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                <option value="">None</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <DocumentScopingEditor
              profileKeyPatterns={profileKeyPatterns}
              onProfileKeyPatternsChange={setProfileKeyPatterns}
              signalCategories={signalCategories}
              onSignalCategoriesChange={setSignalCategories}
            />
            <p className="text-[10px] text-gray-500">
              Left empty on purpose, or unsure? Empty means unscoped — this document type will receive the full
              client profile.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-gray-700/50 text-gray-300 hover:bg-gray-800/50">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
