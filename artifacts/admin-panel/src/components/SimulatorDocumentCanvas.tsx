// artifacts/admin-panel/src/components/SimulatorDocumentCanvas.tsx
//
// Center view for the Simulator Studio's "Documents" node (Phase 7). Tenant/
// project picker mirrors DocumentGeneratorIde.tsx's tenant-native fetch
// pattern (GET /api/admin/document-generator/tenants,
// GET /api/admin/document-generator/tenants/:mspCustomerId/projects), landed
// alongside it in Phase 9. Dry-Run/Real AI toggle defaults to Dry-Run so a
// stray click can't spend real AI tokens by accident:
//   - Dry-Run → GET /api/admin/document-types/:key/preview, rendered through
//     the shared DocumentTypePreviewContent (same component the modal dialog
//     uses, extracted in this same phase).
//   - Real AI → POST /api/admin/document-generator/document-types/:key/generate
//     (unchanged route/behavior), rendered live via the srcDoc iframe pattern
//     RunDetailContent.tsx's HtmlContentPreview already established.
// The properties panel below reuses DocumentTypesManager.tsx's exact
// fields/editors (JSON-array CodeMirror editor for the two scoping fields +
// sections) and submits through the existing PUT /admin/document-types/:key.
// `category` is immutable server-side (updateSchema omits it) so it's shown
// read-only here, matching DocumentTypesManager's edit-mode behavior. "Edit
// Prompt" stays a deep link to /prompt-center/:id — no prompt body editor
// lives here, that stays Prompt Center's job.

import { useEffect, useState } from "react";
import { Link } from "wouter";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { toast } from "sonner";
import { ExternalLink, Loader2, Play, Eye, Sparkles, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import DocumentTypePreviewContent, { type DocumentTypePreviewData } from "./DocumentTypePreviewContent";
import type { DocumentTypeNode } from "./SimulatorLeftTree";

interface TenantOption {
  id: number;
  name: string;
  tenantId: string | null;
  domain: string | null;
  status: string;
}

interface ProjectOption {
  id: number;
  title: string;
  status: string;
}

interface ServiceOption {
  id: number;
  name: string;
}

type Mode = "dry-run" | "real-ai";

const inputCls =
  "w-full border border-border bg-background text-foreground rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60";
const selectCls = inputCls;

interface PropertiesForm {
  label: string;
  category: "report" | "consulting";
  pipelineCategory: "standalone" | "pipeline_output";
  serviceId: string;
  sectionHintsRaw: string;
  sectionsRaw: string;
  includedProfileKeyPatternsRaw: string;
  includedSignalCategoriesRaw: string;
}

function toForm(doc: DocumentTypeNode): PropertiesForm {
  return {
    label: doc.label,
    category: doc.category,
    pipelineCategory: doc.pipelineCategory,
    serviceId: doc.serviceId != null ? String(doc.serviceId) : "",
    sectionHintsRaw: doc.sectionHints ?? "",
    sectionsRaw: JSON.stringify(doc.sections ?? [], null, 2),
    includedProfileKeyPatternsRaw: JSON.stringify(doc.includedProfileKeyPatterns ?? [], null, 2),
    includedSignalCategoriesRaw: JSON.stringify(doc.includedSignalCategories ?? [], null, 2),
  };
}

export function SimulatorDocumentCanvas({ documentType }: { documentType: DocumentTypeNode }) {
  const { fetchWithAuth } = useAuth();

  const [doc, setDoc] = useState<DocumentTypeNode>(documentType);

  // Tenant / project picker
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  // Mode + action state
  const [mode, setMode] = useState<Mode>("dry-run");
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<DocumentTypePreviewData | null>(null);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Properties panel
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [form, setForm] = useState<PropertiesForm>(() => toForm(documentType));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-seed everything whenever a different document type is selected in the tree.
  useEffect(() => {
    setDoc(documentType);
    setForm(toForm(documentType));
    setFormError(null);
    setPreview(null);
    setGeneratedHtml(null);
    setActionError(null);
  }, [documentType]);

  useEffect(() => {
    fetchWithAuth("/api/admin/document-generator/tenants")
      .then((r) => r.json())
      .then((d: unknown) => setTenants(Array.isArray(d) ? (d as TenantOption[]) : []))
      .catch(() => {
        /* non-fatal */
      });
  }, [fetchWithAuth]);

  useEffect(() => {
    fetchWithAuth("/api/admin/services")
      .then((r) => r.json())
      .then((d: unknown) =>
        setServices(Array.isArray(d) ? (d as ServiceOption[]).map((s) => ({ id: s.id, name: s.name })) : []),
      )
      .catch(() => {
        /* non-fatal */
      });
  }, [fetchWithAuth]);

  useEffect(() => {
    if (selectedCustomerId == null) {
      setProjects([]);
      setSelectedProjectId(null);
      return;
    }
    setSelectedProjectId(null);
    fetchWithAuth(`/api/admin/document-generator/tenants/${selectedCustomerId}/projects`)
      .then((r) => r.json())
      .then((d: unknown) => setProjects(Array.isArray(d) ? (d as ProjectOption[]) : []))
      .catch(() => setProjects([]));
  }, [selectedCustomerId, fetchWithAuth]);

  const runAction = async () => {
    if (running) return;
    if (selectedCustomerId == null) {
      toast.error("Select a tenant first");
      return;
    }
    setRunning(true);
    setActionError(null);
    setPreview(null);
    setGeneratedHtml(null);
    try {
      if (mode === "dry-run") {
        const qs = new URLSearchParams({ mspCustomerId: String(selectedCustomerId) });
        if (selectedProjectId != null) qs.set("projectId", String(selectedProjectId));
        const res = await fetchWithAuth(`/api/admin/document-types/${encodeURIComponent(doc.key)}/preview?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Preview failed");
        setPreview(data.preview);
      } else {
        const res = await fetchWithAuth(
          `/api/admin/document-generator/document-types/${encodeURIComponent(doc.key)}/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mspCustomerId: selectedCustomerId, projectId: selectedProjectId ?? 0 }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Generation failed");
        setGeneratedHtml(data.htmlContent);
        toast.success(`Document generated — #${data.documentId}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message);
      toast.error(mode === "dry-run" ? "Preview failed" : "Generation failed");
    } finally {
      setRunning(false);
    }
  };

  const saveProperties = async () => {
    let sections: { id: string; heading: string; guidance: string }[];
    try {
      const parsed = JSON.parse(form.sectionsRaw);
      if (!Array.isArray(parsed)) throw new Error("Sections must be a JSON array");
      for (const s of parsed) {
        if (
          typeof s !== "object" ||
          s === null ||
          typeof s.id !== "string" ||
          typeof s.heading !== "string" ||
          typeof s.guidance !== "string"
        ) {
          throw new Error("Each section must have string id, heading, and guidance fields");
        }
      }
      sections = parsed;
    } catch (err) {
      setFormError(err instanceof Error ? `Sections JSON error: ${err.message}` : "Invalid sections JSON");
      return;
    }

    let includedProfileKeyPatterns: string[];
    try {
      const parsed = JSON.parse(form.includedProfileKeyPatternsRaw);
      if (!Array.isArray(parsed) || !parsed.every((p: unknown) => typeof p === "string")) {
        throw new Error("Must be a JSON array of strings");
      }
      includedProfileKeyPatterns = parsed as string[];
    } catch (err) {
      setFormError(
        err instanceof Error ? `Profile Key Patterns JSON error: ${err.message}` : "Invalid profile key patterns JSON",
      );
      return;
    }

    let includedSignalCategories: string[];
    try {
      const parsed = JSON.parse(form.includedSignalCategoriesRaw);
      if (!Array.isArray(parsed) || !parsed.every((p: unknown) => typeof p === "string")) {
        throw new Error("Must be a JSON array of strings");
      }
      includedSignalCategories = parsed as string[];
    } catch (err) {
      setFormError(
        err instanceof Error ? `Signal Categories JSON error: ${err.message}` : "Invalid signal categories JSON",
      );
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      // `category` is intentionally omitted — updateSchema (admin-document-types.ts)
      // omits it from the PUT payload, same as DocumentTypesManager.tsx's edit path.
      const body = {
        label: form.label.trim(),
        pipelineCategory: form.pipelineCategory,
        serviceId: form.serviceId.trim() !== "" ? Number(form.serviceId) : null,
        sectionHints: form.sectionHintsRaw.trim() !== "" ? form.sectionHintsRaw : null,
        sections,
        includedProfileKeyPatterns,
        includedSignalCategories,
      };
      const res = await fetchWithAuth(`/api/admin/document-types/${encodeURIComponent(doc.key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save document type");
      setDoc(data);
      setForm(toForm(data));
      toast.success("Document type saved");
      // Refetch so the tree's warning-triangle state and this pane's fields
      // reflect the saved row (same pattern simulator-endpoints-updated uses).
      window.dispatchEvent(new CustomEvent("simulator-documents-updated"));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save document type");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background p-4">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">{doc.label}</h3>
            <span className="rounded-sm border border-border bg-card px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              {doc.category}
            </span>
            <span className="rounded-sm border border-border bg-card px-1.5 py-px text-[9px] font-medium text-muted-foreground">
              {doc.pipelineCategory}
            </span>
          </div>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{doc.key}</p>
        </div>
        {doc.aiPromptId != null && (
          <Link
            href={`/prompt-center/${doc.aiPromptId}`}
            className="inline-flex shrink-0 items-center gap-1.5 text-xs text-primary hover:opacity-80"
          >
            Edit Prompt <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {doc.aiPromptId == null && (
        <div className="mb-3 flex items-start gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>No AI prompt configured — this document type has no database-backed generation logic yet.</span>
        </div>
      )}

      {/* Tenant / project picker + mode toggle + action */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className={`${selectCls} max-w-[220px]`}
          value={selectedCustomerId ?? ""}
          onChange={(e) => setSelectedCustomerId(e.target.value ? parseInt(e.target.value, 10) : null)}
        >
          <option value="">Select tenant…</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.tenantId == null ? `⚠ ${t.name} (not yet connected)` : t.name}
            </option>
          ))}
        </select>
        <select
          className={`${selectCls} max-w-[220px]`}
          value={selectedProjectId ?? ""}
          onChange={(e) => setSelectedProjectId(e.target.value ? parseInt(e.target.value, 10) : null)}
          disabled={selectedCustomerId == null}
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>

        {/* Dry-Run / Real AI toggle — defaults to Dry-Run so nothing spends
            real AI tokens by accident. */}
        <div className="ml-auto flex items-center rounded-md border border-border bg-card p-0.5 text-[11px]">
          <button
            onClick={() => setMode("dry-run")}
            className={`rounded px-2.5 py-1 font-semibold transition-colors ${
              mode === "dry-run" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Dry-Run
          </button>
          <button
            onClick={() => setMode("real-ai")}
            className={`rounded px-2.5 py-1 font-semibold transition-colors ${
              mode === "real-ai" ? "bg-destructive text-destructive-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Real AI
          </button>
        </div>

        <button
          onClick={() => void runAction()}
          disabled={running || selectedCustomerId == null}
          className="flex shrink-0 items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          title={selectedCustomerId == null ? "Select a tenant first" : undefined}
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : mode === "dry-run" ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {mode === "dry-run" ? "Preview" : "Generate"}
        </button>
      </div>

      {running && mode === "real-ai" && (
        <div className="mb-3 flex items-center gap-2 rounded border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating with real AI — this can take several minutes.
        </div>
      )}

      {actionError && (
        <p className="mb-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          {actionError}
        </p>
      )}

      {preview && (
        <div className="mb-4">
          <DocumentTypePreviewContent docTypeLabel={doc.label} preview={preview} />
        </div>
      )}

      {generatedHtml && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Generated document
          </div>
          <iframe
            srcDoc={generatedHtml}
            sandbox="allow-same-origin"
            className="w-full rounded-lg border border-border bg-white"
            style={{ height: 480 }}
            title="Generated document preview"
          />
        </div>
      )}

      {/* Editable properties panel — same fields/editors DocumentTypesManager.tsx
          already uses, submitting through the existing PUT route. */}
      <div className="mt-2 border-t border-border pt-3">
        <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Properties</h4>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Label</label>
            <input className={inputCls} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Category</label>
              <select className={selectCls} value={form.category} disabled>
                <option value="report">report</option>
                <option value="consulting">consulting</option>
              </select>
              <p className="text-[10px] text-muted-foreground/60">Set at creation, immutable here.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Pipeline category</label>
              <select
                className={selectCls}
                value={form.pipelineCategory}
                onChange={(e) => setForm((f) => ({ ...f, pipelineCategory: e.target.value as "standalone" | "pipeline_output" }))}
              >
                <option value="standalone">standalone</option>
                <option value="pipeline_output">pipeline_output</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Linked service</label>
            <select className={selectCls} value={form.serviceId} onChange={(e) => setForm((f) => ({ ...f, serviceId: e.target.value }))}>
              <option value="">(none)</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              Section hints{" "}
              <span className="font-normal text-muted-foreground/60">
                (consulting types only — substituted into the {"{{sectionHints}}"} prompt token)
              </span>
            </label>
            <textarea
              className={`${inputCls} min-h-[80px] font-mono`}
              value={form.sectionHintsRaw}
              onChange={(e) => setForm((f) => ({ ...f, sectionHintsRaw: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              Sections <span className="font-normal text-muted-foreground/60">(JSON array of {"{"}id, heading, guidance{"}"})</span>
            </label>
            <div className="overflow-hidden rounded-md border border-border" style={{ height: "180px" }}>
              <CodeMirror
                value={form.sectionsRaw}
                onChange={(value) => setForm((f) => ({ ...f, sectionsRaw: value }))}
                extensions={[json()]}
                theme={oneDark}
                height="100%"
                style={{ height: "100%", fontSize: "12px" }}
                basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              Profile Key Patterns{" "}
              <span className="font-normal text-muted-foreground/60">(JSON array of strings, wildcard suffix supported, e.g. "copilot*")</span>
            </label>
            <div className="overflow-hidden rounded-md border border-border" style={{ height: "120px" }}>
              <CodeMirror
                value={form.includedProfileKeyPatternsRaw}
                onChange={(value) => setForm((f) => ({ ...f, includedProfileKeyPatternsRaw: value }))}
                extensions={[json()]}
                theme={oneDark}
                height="100%"
                style={{ height: "100%", fontSize: "12px" }}
                basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              Signal Categories <span className="font-normal text-muted-foreground/60">(JSON array of signal key prefixes, e.g. "security:")</span>
            </label>
            <div className="overflow-hidden rounded-md border border-border" style={{ height: "120px" }}>
              <CodeMirror
                value={form.includedSignalCategoriesRaw}
                onChange={(value) => setForm((f) => ({ ...f, includedSignalCategoriesRaw: value }))}
                extensions={[json()]}
                theme={oneDark}
                height="100%"
                style={{ height: "100%", fontSize: "12px" }}
                basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
              />
            </div>
          </div>

          {formError && <p className="text-xs text-red-400">{formError}</p>}

          <div className="flex justify-end">
            <button
              onClick={() => void saveProperties()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
