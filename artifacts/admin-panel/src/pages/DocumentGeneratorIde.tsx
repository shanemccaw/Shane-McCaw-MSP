import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { FileText, Eye, Play, Loader2, RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";
import DocumentTypePreviewDialog from "@/components/DocumentTypePreviewDialog";

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
}

interface ClientOption {
  id: number;
  name: string | null;
  company: string | null;
  email: string;
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

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  const [generatingKey, setGeneratingKey] = useState<string | null>(null);

  const [previewData, setPreviewData] = useState<{ docTypeLabel: string; preview: any } | null>(null);
  const [previewLoadingKey, setPreviewLoadingKey] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

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

  useEffect(() => { void loadDocTypes(); }, [loadDocTypes]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  useEffect(() => {
    fetchWithAuth("/api/admin/clients")
      .then(r => r.json())
      .then((d: unknown) => setClients(Array.isArray(d) ? (d as ClientOption[]) : []))
      .catch(() => { /* non-fatal */ });
  }, [fetchWithAuth]);

  useEffect(() => {
    if (selectedClientId == null) { setProjects([]); setSelectedProjectId(null); return; }
    setSelectedProjectId(null);
    fetchWithAuth(`/api/admin/document-generator/clients/${selectedClientId}/projects`)
      .then(r => r.json())
      .then((d: unknown) => setProjects(Array.isArray(d) ? (d as ProjectOption[]) : []))
      .catch(() => setProjects([]));
  }, [selectedClientId, fetchWithAuth]);

  const openPreview = async (type: DocumentType) => {
    if (selectedClientId == null) {
      toast({ title: "Select a client first", description: "Preview needs a target client to scope real data against.", variant: "destructive" });
      return;
    }
    setPreviewLoadingKey(type.key);
    try {
      const qs = new URLSearchParams({ clientUserId: String(selectedClientId) });
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

  const generateNow = async (type: DocumentType) => {
    if (selectedClientId == null) {
      toast({ title: "Select a client first", description: "Generation needs a target client.", variant: "destructive" });
      return;
    }
    setGeneratingKey(type.key);
    try {
      const res = await fetchWithAuth(`/api/admin/document-generator/document-types/${encodeURIComponent(type.key)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientUserId: selectedClientId, projectId: selectedProjectId ?? 0 }),
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
            value={selectedClientId ?? ""}
            onChange={e => setSelectedClientId(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-card border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            <option value="">Select client…</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.company || c.name || c.email}</option>
            ))}
          </select>
          <select
            value={selectedProjectId ?? ""}
            onChange={e => setSelectedProjectId(e.target.value ? parseInt(e.target.value, 10) : null)}
            disabled={selectedClientId == null}
            className="bg-card border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            <option value="">No project</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
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
    </div>
  );
}
