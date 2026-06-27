import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PsScriptPermissions {
  appPermissions: string[];
  delegatedPermissions: string[];
  notes: string;
}

interface PsScriptListItem {
  id: string;
  title: string;
  description: string | null;
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface PsScriptDetail extends PsScriptListItem {
  scriptBody: string;
  permissions: PsScriptPermissions;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: "m365", label: "Microsoft 365 (General)" },
  { value: "azure", label: "Azure" },
  { value: "exchange", label: "Exchange Online" },
  { value: "sharepoint", label: "SharePoint" },
  { value: "teams", label: "Microsoft Teams" },
  { value: "onedrive", label: "OneDrive" },
  { value: "entra-id", label: "Entra ID (Azure AD)" },
  { value: "intune", label: "Intune" },
  { value: "defender", label: "Defender" },
  { value: "purview", label: "Purview" },
  { value: "dlp", label: "DLP" },
  { value: "sensitivity-labels", label: "Sensitivity Labels" },
  { value: "compliance", label: "Compliance Center" },
  { value: "power-platform", label: "Power Platform" },
  { value: "power-automate", label: "Power Automate" },
  { value: "power-apps", label: "Power Apps" },
  { value: "viva", label: "Viva" },
  { value: "security", label: "Security & Compliance" },
  { value: "other", label: "Other" },
];

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(path: string, token: string, opts: RequestInit = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function downloadFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  });
}

function slugify(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "script";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: string }) {
  const label = CATEGORY_MAP[category] ?? category;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-[#0078D4]/15 text-[#58A6FF] border border-[#0078D4]/25 uppercase tracking-wide">
      {label}
    </span>
  );
}

function PermissionBadge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[#1C2128] border border-[#30363D] text-[#C9D1D9]">
      {text}
    </span>
  );
}

function PermissionsPanel({ permissions }: { permissions: PsScriptPermissions }) {
  const [open, setOpen] = useState(true);
  const hasAny = permissions.appPermissions.length > 0 || permissions.delegatedPermissions.length > 0 || permissions.notes;
  if (!hasAny) return null;

  return (
    <div className="border border-[#30363D] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-[#1C2128] hover:bg-[#21262D] transition-colors text-left"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-[#E6EDF3]">
          <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          Required Permissions
        </div>
        <svg className={`w-4 h-4 text-[#7D8590] transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3 bg-[#0D1117]">
          {permissions.appPermissions.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-[#7D8590] uppercase tracking-wide mb-1.5">
                Application (App-Only) Permissions
              </p>
              <div className="flex flex-wrap gap-1.5">
                {permissions.appPermissions.map((p) => <PermissionBadge key={p} text={p} />)}
              </div>
            </div>
          )}
          {permissions.delegatedPermissions.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-[#7D8590] uppercase tracking-wide mb-1.5">
                Delegated (User) Permissions
              </p>
              <div className="flex flex-wrap gap-1.5">
                {permissions.delegatedPermissions.map((p) => <PermissionBadge key={p} text={p} />)}
              </div>
            </div>
          )}
          {permissions.notes && (
            <p className="text-xs text-[#8B949E] leading-relaxed border-t border-[#30363D] pt-2">
              {permissions.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Save-to-Library modal ────────────────────────────────────────────────────

function SaveModal({
  scriptBody,
  permissions,
  category,
  token,
  onSaved,
  onClose,
}: {
  scriptBody: string;
  permissions: PsScriptPermissions;
  category: string;
  token: string;
  onSaved: (script: PsScriptListItem) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!title.trim()) { setError("Title is required"); return; }
    setSaving(true);
    setError("");
    try {
      const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
      const result = await apiFetch("/admin/ps-scripts", token, {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), description: description.trim() || null, category, scriptBody, permissions, tags }),
      }) as PsScriptListItem;
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#E6EDF3]">Save to Library</h3>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors p-1 rounded">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#8B949E] mb-1">Title <span className="text-red-400">*</span></label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. List Teams with 100+ Members"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#8B949E] mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional description…"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#8B949E] mb-1">Tags (comma-separated)</label>
            <input
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="e.g. teams, reporting, csv"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-[#0078D4] hover:bg-[#0086EF] disabled:opacity-50 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[#7D8590] hover:text-[#E6EDF3] border border-[#30363D] rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Script detail drawer ─────────────────────────────────────────────────────

function ScriptDrawer({
  scriptId,
  token,
  onClose,
  onLoadInEditor,
  onDeleted,
}: {
  scriptId: string;
  token: string;
  onClose: () => void;
  onLoadInEditor: (script: PsScriptDetail) => void;
  onDeleted: (id: string) => void;
}) {
  const [script, setScript] = useState<PsScriptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(`/admin/ps-scripts/${scriptId}`, token)
      .then((s) => { if (!cancelled) setScript(s as PsScriptDetail); })
      .catch(() => { if (!cancelled) toast({ title: "Failed to load script", variant: "destructive" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptId]);

  const handleCopy = () => {
    if (!script) return;
    copyToClipboard(script.scriptBody);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!script) return;
    downloadFile(script.scriptBody, `${slugify(script.title)}.ps1`);
  };

  const handleDelete = async () => {
    if (!script || !confirm(`Delete "${script.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/admin/ps-scripts/${script.id}`, token, { method: "DELETE" });
      onDeleted(script.id);
    } catch {
      toast({ title: "Failed to delete script", variant: "destructive" });
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#161B22] border border-[#30363D] h-full sm:h-full w-full sm:max-w-2xl flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D] flex-shrink-0">
          {script && <CategoryBadge category={script.category} />}
          <div className="flex items-center gap-2 ml-auto">
            {script && (
              <>
                <button
                  onClick={handleCopy}
                  title="Copy script"
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors"
                >
                  {copied ? (
                    <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={handleDownload}
                  title="Download .ps1"
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  .ps1
                </button>
                <button
                  onClick={() => onLoadInEditor(script)}
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-[#0078D4]/15 border border-[#0078D4]/30 text-[#58A6FF] hover:bg-[#0078D4]/25 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  Open in Editor
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  title="Delete script"
                  className="p-1.5 text-[#7D8590] hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </>
            )}
            <button onClick={onClose} className="p-1.5 text-[#7D8590] hover:text-[#E6EDF3] rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {script && !loading && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-[#E6EDF3]">{script.title}</h2>
              {script.description && <p className="text-sm text-[#8B949E] mt-1">{script.description}</p>}
              <p className="text-xs text-[#484F58] mt-1">Saved {formatDate(script.createdAt)}</p>
            </div>
            {script.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {script.tags.map((t) => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-[#21262D] text-[#8B949E] border border-[#30363D]">{t}</span>
                ))}
              </div>
            )}
            <PermissionsPanel permissions={script.permissions} />
            <div>
              <p className="text-xs font-semibold text-[#7D8590] uppercase tracking-wide mb-2">Script</p>
              <pre className="bg-[#0D1117] border border-[#30363D] rounded-lg p-4 text-xs text-[#C9D1D9] font-mono overflow-x-auto whitespace-pre leading-relaxed">
                {script.scriptBody}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Generator Tab ────────────────────────────────────────────────────────────

const BASE_INSTRUCTIONS_KEY = "sg:baseInstructions";

function GeneratorTab({
  token,
  initialScript,
  onScriptSaved,
  baseInstructions,
  onBaseInstructionsChange,
}: {
  token: string;
  initialScript?: PsScriptDetail | null;
  onScriptSaved: (s: PsScriptListItem) => void;
  baseInstructions: string;
  onBaseInstructionsChange: (v: string) => void;
}) {
  const [category, setCategory] = useState(initialScript?.category ?? "m365");
  const [prompt, setPrompt] = useState("");
  const [detailedInstructions, setDetailedInstructions] = useState("");
  const [scriptBody, setScriptBody] = useState(initialScript?.scriptBody ?? "");
  const [permissions, setPermissions] = useState<PsScriptPermissions>(
    initialScript?.permissions ?? { appPermissions: [], delegatedPermissions: [], notes: "" }
  );
  const [generating, setGenerating] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const generate = async () => {
    if (!prompt.trim()) { toast({ title: "Enter a description first", variant: "destructive" }); return; }
    setGenerating(true);
    setScriptBody("");
    setPermissions({ appPermissions: [], delegatedPermissions: [], notes: "" });
    try {
      const result = await apiFetch("/admin/ps-scripts/generate", token, {
        method: "POST",
        body: JSON.stringify({
          prompt: prompt.trim(),
          category,
          baseInstructions: baseInstructions.trim() || undefined,
          detailedInstructions: detailedInstructions.trim() || undefined,
        }),
      }) as { script: string; permissions: PsScriptPermissions };
      setScriptBody(result.script);
      setPermissions(result.permissions);
    } catch (e) {
      toast({ title: "Generation failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!scriptBody) return;
    copyToClipboard(scriptBody);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!scriptBody) return;
    downloadFile(scriptBody, `script-${Date.now()}.ps1`);
  };

  return (
    <div className="space-y-5">
      {/* Instructions panel */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <svg className="w-4 h-4 text-[#58A6FF] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Custom Instructions</h3>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-[#8B949E]">Base Instructions</label>
            <span className="text-[10px] text-[#484F58] bg-[#0D1117] border border-[#30363D] rounded px-1.5 py-0.5">Saved · applied to every generation</span>
          </div>
          <textarea
            value={baseInstructions}
            onChange={(e) => onBaseInstructionsChange(e.target.value)}
            rows={3}
            placeholder="e.g. Always use the PnP PowerShell module. Follow Microsoft best practices. Include error handling and verbose logging in every script."
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2.5 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors resize-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-[#8B949E]">Detailed Instructions</label>
            <span className="text-[10px] text-[#484F58] bg-[#0D1117] border border-[#30363D] rounded px-1.5 py-0.5">This generation only</span>
          </div>
          <textarea
            value={detailedInstructions}
            onChange={(e) => setDetailedInstructions(e.target.value)}
            rows={3}
            placeholder="e.g. The tenant uses a hybrid setup — avoid any commands that require cloud-only connectivity. Output must be compatible with PowerShell 5.1."
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2.5 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors resize-none"
          />
        </div>
      </div>

      {/* Prompt controls */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="sm:w-64 flex-shrink-0">
            <label className="block text-xs font-medium text-[#8B949E] mb-1.5">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 transition-colors"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#8B949E] mb-1.5">Describe what you need</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="e.g. List all Teams with more than 100 members and export to CSV with owner names, member count, and creation date…"
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2.5 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors resize-none"
          />
        </div>

        <button
          onClick={generate}
          disabled={generating}
          className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#0086EF] disabled:opacity-50 text-white text-sm font-semibold py-2 px-5 rounded-lg transition-colors"
        >
          {generating ? (
            <>
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate Script
            </>
          )}
        </button>
      </div>

      {/* Generated output */}
      {scriptBody && (
        <div className="space-y-4">
          {/* Permissions */}
          <PermissionsPanel permissions={permissions} />

          {/* Script editor */}
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#1C2128] border-b border-[#30363D]">
              <div className="flex items-center gap-2 text-xs font-medium text-[#7D8590]">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                PowerShell Script
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCopy}
                  title="Copy to clipboard"
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors"
                >
                  {copied ? (
                    <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  )}
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={handleDownload}
                  title="Download .ps1 file"
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Download .ps1
                </button>
                <button
                  onClick={() => setShowSaveModal(true)}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-[#0078D4]/15 border border-[#0078D4]/30 text-[#58A6FF] hover:bg-[#0078D4]/25 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                  Save to Library
                </button>
              </div>
            </div>
            <textarea
              value={scriptBody}
              onChange={(e) => setScriptBody(e.target.value)}
              spellCheck={false}
              className="w-full bg-[#0D1117] text-[#C9D1D9] font-mono text-xs leading-relaxed p-4 outline-none resize-y min-h-[400px] block"
              style={{ fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace" }}
            />
          </div>
        </div>
      )}

      {showSaveModal && (
        <SaveModal
          scriptBody={scriptBody}
          permissions={permissions}
          category={category}
          token={token}
          onSaved={(s) => { onScriptSaved(s); setShowSaveModal(false); }}
          onClose={() => setShowSaveModal(false)}
        />
      )}
    </div>
  );
}

// ─── Library Tab ──────────────────────────────────────────────────────────────

function LibraryTab({
  token,
  scripts,
  loading,
  onOpenScript,
  onDeleteScript,
}: {
  token: string;
  scripts: PsScriptListItem[];
  loading: boolean;
  onOpenScript: (id: string) => void;
  onDeleteScript: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");

  const filtered = scripts.filter((s) => {
    const q = search.toLowerCase();
    const matchQ = !q || s.title.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q));
    const matchCat = catFilter === "all" || s.category === catFilter;
    return matchQ && matchCat;
  });

  const usedCategories = [...new Set(scripts.map((s) => s.category))];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#484F58]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search scripts…"
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg pl-9 pr-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors"
          />
        </div>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 transition-colors"
        >
          <option value="all">All Categories</option>
          {usedCategories.map((c) => (
            <option key={c} value={c}>{CATEGORY_MAP[c] ?? c}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg className="w-10 h-10 text-[#30363D] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          <p className="text-sm text-[#7D8590]">{scripts.length === 0 ? "No scripts saved yet. Generate one in the Generator tab." : "No scripts match your search."}</p>
        </div>
      ) : (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#30363D] bg-[#1C2128]">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#7D8590] uppercase tracking-wide">Title</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#7D8590] uppercase tracking-wide hidden md:table-cell">Category</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#7D8590] uppercase tracking-wide hidden lg:table-cell">Saved</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#21262D]">
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className="hover:bg-[#1C2128] transition-colors cursor-pointer"
                  onClick={() => onOpenScript(s.id)}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#E6EDF3] truncate max-w-xs">{s.title}</p>
                    {s.description && (
                      <p className="text-xs text-[#7D8590] truncate max-w-xs mt-0.5">{s.description}</p>
                    )}
                    {s.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.tags.slice(0, 3).map((t) => (
                          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#21262D] text-[#8B949E] border border-[#30363D]">{t}</span>
                        ))}
                        {s.tags.length > 3 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#21262D] text-[#484F58]">+{s.tags.length - 3}</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <CategoryBadge category={s.category} />
                  </td>
                  <td className="px-4 py-3 text-xs text-[#7D8590] hidden lg:table-cell whitespace-nowrap">
                    {formatDate(s.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onOpenScript(s.id)}
                        className="p-1.5 text-[#7D8590] hover:text-[#58A6FF] hover:bg-[#0078D4]/10 rounded-lg transition-colors"
                        title="Open"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      </button>
                      <button
                        onClick={() => onDeleteScript(s.id)}
                        className="p-1.5 text-[#7D8590] hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ScriptGeneratorPage() {
  const { accessToken } = useAuth();
  const token = accessToken ?? "";
  const { toast } = useToast();

  const [tab, setTab] = useState<"generator" | "library">("generator");
  const [scripts, setScripts] = useState<PsScriptListItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [openScriptId, setOpenScriptId] = useState<string | null>(null);
  const [editorScript, setEditorScript] = useState<PsScriptDetail | null>(null);
  const [baseInstructions, setBaseInstructions] = useState<string>(() => {
    try { return localStorage.getItem(BASE_INSTRUCTIONS_KEY) ?? ""; } catch { return ""; }
  });

  const handleBaseInstructionsChange = useCallback((v: string) => {
    setBaseInstructions(v);
    try { localStorage.setItem(BASE_INSTRUCTIONS_KEY, v); } catch { /* ignore */ }
  }, []);

  const loadLibrary = useCallback(async () => {
    if (libraryLoaded && !libraryLoading) return;
    setLibraryLoading(true);
    try {
      const list = await apiFetch("/admin/ps-scripts", token) as PsScriptListItem[];
      setScripts(list);
      setLibraryLoaded(true);
    } catch {
      toast({ title: "Failed to load library", variant: "destructive" });
    } finally {
      setLibraryLoading(false);
    }
  }, [libraryLoaded, libraryLoading, token, toast]);

  const handleTabChange = (t: "generator" | "library") => {
    setTab(t);
    if (t === "library" && !libraryLoaded) loadLibrary();
  };

  const handleScriptSaved = (s: PsScriptListItem) => {
    setScripts((prev) => [s, ...prev]);
    setLibraryLoaded(true);
    toast({ title: "Script saved to library" });
  };

  const handleDeleteScript = async (id: string) => {
    if (!confirm("Delete this script? This cannot be undone.")) return;
    try {
      await apiFetch(`/admin/ps-scripts/${id}`, token, { method: "DELETE" });
      setScripts((prev) => prev.filter((s) => s.id !== id));
      toast({ title: "Script deleted" });
    } catch {
      toast({ title: "Failed to delete script", variant: "destructive" });
    }
  };

  const handleLoadInEditor = (script: PsScriptDetail) => {
    setEditorScript(script);
    setOpenScriptId(null);
    setTab("generator");
  };

  const handleOpenScriptId = (id: string) => {
    setOpenScriptId(id);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#0078D4]/15 border border-[#0078D4]/25 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Script Generator</h1>
          <p className="text-sm text-[#7D8590]">AI-powered PowerShell scripts for M365 & Azure — with permissions analysis</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#161B22] border border-[#30363D] rounded-xl p-1 w-fit">
        {(["generator", "library"] as const).map((t) => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t
                ? "bg-[#0078D4]/15 text-[#58A6FF] border border-[#0078D4]/25"
                : "text-[#7D8590] hover:text-[#E6EDF3] border border-transparent"
            }`}
          >
            {t === "generator" ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            )}
            {t === "generator" ? "Generator" : `Library${scripts.length > 0 ? ` (${scripts.length})` : ""}`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "generator" && (
        <GeneratorTab
          key={editorScript?.id ?? "new"}
          token={token}
          initialScript={editorScript}
          onScriptSaved={handleScriptSaved}
          baseInstructions={baseInstructions}
          onBaseInstructionsChange={handleBaseInstructionsChange}
        />
      )}
      {tab === "library" && (
        <LibraryTab
          token={token}
          scripts={scripts}
          loading={libraryLoading}
          onOpenScript={handleOpenScriptId}
          onDeleteScript={handleDeleteScript}
        />
      )}

      {/* Script detail drawer */}
      {openScriptId !== null && (
        <ScriptDrawer
          scriptId={openScriptId}
          token={token}
          onClose={() => setOpenScriptId(null)}
          onLoadInEditor={handleLoadInEditor}
          onDeleted={(id) => {
            setScripts((prev) => prev.filter((s) => s.id !== id));
            setOpenScriptId(null);
            toast({ title: "Script deleted" });
          }}
        />
      )}
    </div>
  );
}
