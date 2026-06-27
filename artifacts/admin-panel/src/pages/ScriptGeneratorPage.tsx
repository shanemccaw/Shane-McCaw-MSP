import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { zipSync, strToU8 } from "fflate";

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

interface ScriptModuleItem {
  id?: string;
  filename: string;
  description: string | null;
  content: string;
}

interface ScriptPackageListItem {
  id: string;
  title: string;
  category: string;
  permissions: PsScriptPermissions;
  tags: string[];
  createdAt: string;
  modules: ScriptModuleItem[];
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

function downloadAllModulesAsZip(modules: ScriptModuleItem[], packageTitle: string) {
  const files: Record<string, Uint8Array> = {};
  for (const m of modules) {
    files[m.filename] = strToU8(m.content);
  }
  const zipped = zipSync(files, { level: 6 });
  const slug = packageTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "package";
  const blob = new Blob([zipped], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}.zip`;
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

function PackageBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/25 uppercase tracking-wide">
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
      Package
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

// ─── Module Package View ──────────────────────────────────────────────────────

function ModulePackageView({
  modules,
  packageTitle,
  onBack,
}: {
  modules: ScriptModuleItem[];
  packageTitle: string;
  onBack: () => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const activeModule = modules[activeIdx];

  const handleCopy = (idx: number) => {
    copyToClipboard(modules[idx].content);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Package header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageBadge />
          <span className="text-sm font-medium text-[#E6EDF3]">{modules.length} modules</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadAllModulesAsZip(modules, packageTitle)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 hover:bg-purple-500/25 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Download All (.zip)
          </button>
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Back to single script
          </button>
        </div>
      </div>

      {/* Module tabs */}
      <div className="flex flex-wrap gap-1 bg-[#161B22] border border-[#30363D] rounded-xl p-1">
        {modules.map((m, i) => (
          <button
            key={i}
            onClick={() => setActiveIdx(i)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all truncate max-w-[180px] ${
              activeIdx === i
                ? "bg-purple-500/15 text-purple-400 border border-purple-500/25"
                : "text-[#7D8590] hover:text-[#E6EDF3] border border-transparent"
            }`}
            title={m.filename}
          >
            {m.filename}
          </button>
        ))}
      </div>

      {/* Active module editor */}
      {activeModule && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#1C2128] border-b border-[#30363D]">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs font-medium text-[#7D8590]">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                {activeModule.filename}
              </div>
              {activeModule.description && (
                <p className="text-[10px] text-[#484F58]">{activeModule.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleCopy(activeIdx)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors"
              >
                {copiedIdx === activeIdx ? (
                  <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                )}
                {copiedIdx === activeIdx ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={() => downloadFile(activeModule.content, activeModule.filename)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download
              </button>
            </div>
          </div>
          <pre className="bg-[#0D1117] text-[#C9D1D9] font-mono text-xs leading-relaxed p-4 overflow-x-auto whitespace-pre min-h-[320px] max-h-[500px] overflow-y-auto"
            style={{ fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace" }}>
            {activeModule.content}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Generator Tab ────────────────────────────────────────────────────────────

const BASE_INSTRUCTIONS_KEY = "sg:baseInstructions";
const PROMPT_KEY = "sg:prompt";
const DETAILED_INSTRUCTIONS_KEY = "sg:detailedInstructions";
const CATEGORY_KEY = "sg:category";

function GeneratorTab({
  token,
  initialScript,
  onScriptSaved,
  onPackageSaved,
  baseInstructions,
  onBaseInstructionsChange,
  onScriptUpdated,
}: {
  token: string;
  initialScript?: PsScriptDetail | null;
  onScriptSaved: (s: PsScriptListItem) => void;
  onScriptUpdated?: (s: PsScriptListItem) => void;
  onPackageSaved: (p: ScriptPackageListItem) => void;
  baseInstructions: string;
  onBaseInstructionsChange: (v: string) => void;
}) {
  const [category, setCategory] = useState(() => initialScript?.category ?? localStorage.getItem(CATEGORY_KEY) ?? "m365");
  const [prompt, setPrompt] = useState(() => localStorage.getItem(PROMPT_KEY) ?? "");
  const [detailedInstructions, setDetailedInstructions] = useState(() => localStorage.getItem(DETAILED_INSTRUCTIONS_KEY) ?? "");
  const [scriptBody, setScriptBody] = useState(initialScript?.scriptBody ?? "");
  const [permissions, setPermissions] = useState<PsScriptPermissions>(
    initialScript?.permissions ?? { appPermissions: [], delegatedPermissions: [], notes: "" }
  );
  const [generating, setGenerating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [copied, setCopied] = useState(false);

  // Bug fix state
  const [showBugReporter, setShowBugReporter] = useState(false);
  const [bugDescription, setBugDescription] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixSummary, setFixSummary] = useState("");

  // Modularize state
  const [modularizing, setModularizing] = useState(false);
  const [modules, setModules] = useState<ScriptModuleItem[]>([]);

  const { toast } = useToast();

  const generate = async () => {
    if (!prompt.trim()) { toast({ title: "Enter a description first", variant: "destructive" }); return; }
    setGenerating(true);
    setScriptBody("");
    setPermissions({ appPermissions: [], delegatedPermissions: [], notes: "" });
    setModules([]);
    setFixSummary("");
    setShowBugReporter(false);
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

  const fixBug = async () => {
    if (!bugDescription.trim()) { toast({ title: "Describe the bug first", variant: "destructive" }); return; }
    setFixing(true);
    setFixSummary("");
    try {
      const result = await apiFetch("/admin/ps-scripts/fix", token, {
        method: "POST",
        body: JSON.stringify({
          scriptContent: scriptBody,
          bugDescription: bugDescription.trim(),
          customInstructions: baseInstructions.trim() || undefined,
        }),
      }) as { fixedScript: string; fixSummary: string; permissions: PsScriptPermissions };
      if (!result.fixedScript || result.fixedScript.trim().length < 20) {
        toast({
          title: "Fix could not be applied",
          description: "The AI returned an unreadable response. Your original script has not been changed.",
          variant: "destructive",
        });
        return;
      }
      setScriptBody(result.fixedScript);
      setPermissions(result.permissions);
      setFixSummary(result.fixSummary);
      setBugDescription("");
      setShowBugReporter(false);
    } catch (e) {
      toast({ title: "Fix failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setFixing(false);
    }
  };

  const modularize = async () => {
    setModularizing(true);
    try {
      const result = await apiFetch("/admin/ps-scripts/modularize", token, {
        method: "POST",
        body: JSON.stringify({
          scriptContent: scriptBody,
          title: prompt.trim() || "Modular Package",
          category,
          customInstructions: baseInstructions.trim() || undefined,
        }),
      }) as { packageId: string; title: string; modules: ScriptModuleItem[] };
      setModules(result.modules);
      const pkg: ScriptPackageListItem = {
        id: result.packageId,
        title: result.title,
        category,
        permissions,
        tags: [],
        createdAt: new Date().toISOString(),
        modules: result.modules,
      };
      onPackageSaved(pkg);
      toast({ title: "Package created and saved to Library" });
    } catch (e) {
      toast({ title: "Modularization failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setModularizing(false);
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

  const updateSavedCopy = async () => {
    if (!initialScript?.id || !scriptBody) return;
    setUpdating(true);
    try {
      const updated = await apiFetch(`/admin/ps-scripts/${initialScript.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ scriptBody, permissions }),
      }) as PsScriptListItem;
      onScriptUpdated?.(updated);
      toast({ title: "Library entry updated" });
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setUpdating(false);
    }
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
            onChange={(e) => { setDetailedInstructions(e.target.value); localStorage.setItem(DETAILED_INSTRUCTIONS_KEY, e.target.value); }}
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
              onChange={(e) => { setCategory(e.target.value); localStorage.setItem(CATEGORY_KEY, e.target.value); }}
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
            onChange={(e) => { setPrompt(e.target.value); localStorage.setItem(PROMPT_KEY, e.target.value); }}
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
          {/* Fix summary callout */}
          {fixSummary && (
            <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3">
              <svg className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-green-400 mb-0.5">Bug fixed</p>
                <p className="text-xs text-green-300/80 leading-relaxed">{fixSummary}</p>
              </div>
              <button onClick={() => setFixSummary("")} className="text-green-400/50 hover:text-green-400 transition-colors flex-shrink-0">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          )}

          {/* Permissions */}
          <PermissionsPanel permissions={permissions} />

          {/* Package view or single script view */}
          {modules.length > 0 ? (
            <ModulePackageView modules={modules} packageTitle={prompt.trim() || "package"} onBack={() => setModules([])} />
          ) : (
            <>
              {/* Script editor */}
              <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-[#1C2128] border-b border-[#30363D]">
                  <div className="flex items-center gap-2 text-xs font-medium text-[#7D8590]">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    PowerShell Script
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Modularize button */}
                    <button
                      onClick={modularize}
                      disabled={modularizing}
                      title="Decompose into modules"
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 disabled:opacity-50 transition-colors"
                    >
                      {modularizing ? (
                        <div className="w-3 h-3 border border-purple-400/40 border-t-purple-400 rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                      )}
                      {modularizing ? "Modularizing…" : "Modularize"}
                    </button>
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
                    {initialScript?.id && (
                      <button
                        onClick={updateSavedCopy}
                        disabled={updating || !scriptBody}
                        title="Push current script & permissions back to the saved library entry"
                        className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 disabled:opacity-50 transition-colors"
                      >
                        {updating ? (
                          <div className="w-3 h-3 border border-green-400/40 border-t-green-400 rounded-full animate-spin" />
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        )}
                        {updating ? "Updating…" : "Update saved copy"}
                      </button>
                    )}
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

              {/* Bug reporter */}
              <div className="border border-[#30363D] rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowBugReporter((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-[#161B22] hover:bg-[#1C2128] transition-colors text-left"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-[#8B949E]">
                    <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Report a Bug
                  </div>
                  <svg className={`w-4 h-4 text-[#484F58] transition-transform ${showBugReporter ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showBugReporter && (
                  <div className="px-4 py-4 space-y-3 bg-[#0D1117] border-t border-[#30363D]">
                    <p className="text-xs text-[#7D8590] leading-relaxed">
                      Describe what's wrong with the script and Claude will return a corrected version.
                    </p>
                    <textarea
                      value={bugDescription}
                      onChange={(e) => setBugDescription(e.target.value)}
                      rows={3}
                      placeholder="e.g. The filter for disabled accounts isn't working — it's returning all users instead of only disabled ones…"
                      className="w-full bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-2.5 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-amber-500/50 transition-colors resize-none"
                    />
                    <button
                      onClick={fixBug}
                      disabled={fixing || !bugDescription.trim()}
                      className="flex items-center gap-2 bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-50 border border-amber-500/30 text-amber-400 text-sm font-semibold py-2 px-4 rounded-lg transition-colors"
                    >
                      {fixing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-amber-400/40 border-t-amber-400 rounded-full animate-spin" />
                          Fixing with Claude…
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          Fix with Claude
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
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

interface EditableModule {
  id?: string;
  filename: string;
  description: string;
  content: string;
  isNew?: boolean;
}

function PackageRow({
  pkg,
  token,
  onDeleted,
  onUpdated,
}: {
  pkg: ScriptPackageListItem;
  token: string;
  onDeleted: (id: string) => void;
  onUpdated: (pkg: ScriptPackageListItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editTitle, setEditTitle] = useState(pkg.title);
  const [editCategory, setEditCategory] = useState(pkg.category);
  const [editModules, setEditModules] = useState<EditableModule[]>([]);
  const [expandedModuleIdx, setExpandedModuleIdx] = useState<number | null>(null);
  const { toast } = useToast();

  const enterEditMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(pkg.title);
    setEditCategory(pkg.category);
    setEditModules(pkg.modules.map((m) => ({
      id: m.id,
      filename: m.filename,
      description: m.description ?? "",
      content: m.content,
    })));
    setExpandedModuleIdx(null);
    setEditMode(true);
    setExpanded(true);
  };

  const cancelEditMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditMode(false);
    setExpandedModuleIdx(null);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete package "${pkg.title}" and all its modules? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/admin/ps-scripts/packages/${pkg.id}`, token, { method: "DELETE" });
      onDeleted(pkg.id);
    } catch {
      toast({ title: "Failed to delete package", variant: "destructive" });
      setDeleting(false);
    }
  };

  const updateModule = (idx: number, field: keyof EditableModule, value: string) => {
    setEditModules((prev) => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  const addModule = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newIdx = editModules.length;
    setEditModules((prev) => [...prev, { filename: "NewModule.ps1", description: "", content: "# New module\n", isNew: true }]);
    setExpandedModuleIdx(newIdx);
  };

  const removeModule = (idx: number) => {
    setEditModules((prev) => prev.filter((_, i) => i !== idx));
    setExpandedModuleIdx((prev) => {
      if (prev === null) return null;
      if (prev === idx) return null;
      return prev > idx ? prev - 1 : prev;
    });
  };

  const moveModule = (idx: number, direction: "up" | "down", e: React.MouseEvent) => {
    e.stopPropagation();
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    setEditModules((prev) => {
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[swapIdx]] = [arr[swapIdx]!, arr[idx]!];
      return arr;
    });
    setExpandedModuleIdx((prev) => {
      if (swapIdx < 0 || swapIdx >= editModules.length) return prev;
      if (prev === idx) return swapIdx;
      if (prev === swapIdx) return idx;
      return prev;
    });
  };

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSaving(true);
    try {
      const basePromises: Promise<unknown>[] = [];

      if (editTitle.trim() !== pkg.title || editCategory !== pkg.category) {
        basePromises.push(apiFetch(`/admin/ps-scripts/packages/${pkg.id}`, token, {
          method: "PATCH",
          body: JSON.stringify({ title: editTitle.trim(), category: editCategory }),
        }));
      }

      const deletedModules = pkg.modules.filter((om) => om.id && !editModules.some((em) => em.id === om.id));
      for (const dm of deletedModules) {
        if (dm.id) {
          basePromises.push(apiFetch(`/admin/ps-scripts/modules/${dm.id}`, token, { method: "DELETE" }));
        }
      }

      for (let i = 0; i < editModules.length; i++) {
        const m = editModules[i];
        if (!m || m.isNew) continue;
        if (m.id) {
          const orig = pkg.modules.find((om) => om.id === m.id);
          const origIdx = pkg.modules.findIndex((om) => om.id === m.id);
          const contentChanged = orig && (m.filename !== orig.filename || m.description !== (orig.description ?? "") || m.content !== orig.content);
          const orderChanged = origIdx !== i;
          if (contentChanged || orderChanged) {
            basePromises.push(apiFetch(`/admin/ps-scripts/modules/${m.id}`, token, {
              method: "PUT",
              body: JSON.stringify({ filename: m.filename, description: m.description || null, content: m.content, sortOrder: i }),
            }));
          }
        }
      }

      await Promise.all(basePromises);

      const savedModules: ScriptModuleItem[] = [];
      for (let i = 0; i < editModules.length; i++) {
        const m = editModules[i]!;
        if (m.isNew) {
          const created = await apiFetch(`/admin/ps-scripts/packages/${pkg.id}/modules`, token, {
            method: "POST",
            body: JSON.stringify({ filename: m.filename, description: m.description || null, content: m.content, sortOrder: i }),
          }) as { id: string; filename: string; description: string | null; content: string };
          savedModules.push({ id: created.id, filename: created.filename, description: created.description, content: created.content });
        } else {
          savedModules.push({ id: m.id, filename: m.filename, description: m.description || null, content: m.content });
        }
      }

      const updatedPkg: ScriptPackageListItem = {
        ...pkg,
        title: editTitle.trim(),
        category: editCategory,
        modules: savedModules,
      };
      onUpdated(updatedPkg);
      setEditMode(false);
      setExpandedModuleIdx(null);
      toast({ title: "Package saved" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to save package", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-[#21262D] last:border-b-0">
      <div
        className={`flex items-center px-4 py-3 transition-colors ${editMode ? "bg-[#1C2128]" : "hover:bg-[#1C2128] cursor-pointer"}`}
        onClick={editMode ? undefined : () => setExpanded((v) => !v)}
      >
        {!editMode && (
          <svg className={`w-3.5 h-3.5 text-[#484F58] flex-shrink-0 mr-2 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
        {editMode && <div className="w-5 flex-shrink-0 mr-2" />}
        <div className="flex-1 min-w-0">
          {editMode ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="flex-1 bg-[#0D1117] border border-[#30363D] rounded-lg px-2 py-1 text-sm font-medium text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 transition-colors"
                placeholder="Package title"
              />
              <select
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                className="bg-[#0D1117] border border-[#30363D] rounded-lg px-2 py-1 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 transition-colors"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <p className="font-medium text-[#E6EDF3] truncate max-w-xs">{pkg.title}</p>
                <PackageBadge />
              </div>
              <p className="text-xs text-[#7D8590] mt-0.5">{pkg.modules.length} modules</p>
            </>
          )}
        </div>
        {!editMode && (
          <div className="hidden md:block px-4">
            <CategoryBadge category={pkg.category} />
          </div>
        )}
        {!editMode && (
          <div className="hidden lg:block px-4 text-xs text-[#7D8590] whitespace-nowrap">
            {formatDate(pkg.createdAt)}
          </div>
        )}
        <div className="flex items-center gap-1 pl-2" onClick={(e) => e.stopPropagation()}>
          {editMode ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                title="Save changes"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#0078D4]/15 text-[#58A6FF] border border-[#0078D4]/25 rounded-lg hover:bg-[#0078D4]/25 transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <div className="w-3 h-3 border border-[#58A6FF] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                )}
                Save
              </button>
              <button
                onClick={cancelEditMode}
                disabled={saving}
                title="Cancel"
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-[#7D8590] hover:text-[#E6EDF3] rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={enterEditMode}
                title="Edit package"
                className="p-1.5 text-[#7D8590] hover:text-[#58A6FF] hover:bg-[#0078D4]/10 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); downloadAllModulesAsZip(pkg.modules, pkg.title); }}
                title="Download all modules as .zip"
                className="p-1.5 text-[#7D8590] hover:text-purple-400 hover:bg-purple-400/10 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                title="Delete package"
                className="p-1.5 text-[#7D8590] hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && !editMode && (
        <div className="bg-[#0D1117] border-t border-[#21262D] px-10 py-3 space-y-2">
          {pkg.modules.map((m, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-[#161B22] group transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-3 h-3 text-[#484F58] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                <span className="text-xs font-mono text-[#C9D1D9]">{m.filename}</span>
                {m.description && <span className="text-xs text-[#484F58] truncate hidden sm:inline">— {m.description}</span>}
              </div>
              <button
                onClick={() => downloadFile(m.content, m.filename)}
                title={`Download ${m.filename}`}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[#7D8590] hover:text-[#E6EDF3]"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {editMode && (
        <div className="bg-[#0D1117] border-t border-[#21262D] px-4 py-4 space-y-2">
          {editModules.map((m, i) => (
            <div key={i} className="border border-[#21262D] rounded-lg overflow-hidden">
              <div
                className="flex items-center gap-2 px-3 py-2 bg-[#161B22] cursor-pointer hover:bg-[#1C2128] transition-colors"
                onClick={() => setExpandedModuleIdx(expandedModuleIdx === i ? null : i)}
              >
                <svg className={`w-3 h-3 text-[#484F58] flex-shrink-0 transition-transform ${expandedModuleIdx === i ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                <div className="flex flex-col gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={(e) => moveModule(i, "up", e)}
                    disabled={i === 0}
                    title="Move up"
                    className="p-0.5 text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-20 rounded transition-colors"
                  >
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                  </button>
                  <button
                    onClick={(e) => moveModule(i, "down", e)}
                    disabled={i === editModules.length - 1}
                    title="Move down"
                    className="p-0.5 text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-20 rounded transition-colors"
                  >
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                </div>
                <input
                  value={m.filename}
                  onChange={(e) => { e.stopPropagation(); updateModule(i, "filename", e.target.value); }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 bg-transparent text-xs font-mono text-[#C9D1D9] outline-none border-b border-transparent focus:border-[#0078D4]/40 transition-colors"
                  placeholder="filename.ps1"
                />
                <input
                  value={m.description}
                  onChange={(e) => { e.stopPropagation(); updateModule(i, "description", e.target.value); }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 bg-transparent text-xs text-[#7D8590] outline-none border-b border-transparent focus:border-[#0078D4]/40 transition-colors hidden sm:block"
                  placeholder="Short description…"
                />
                {m.isNew && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">new</span>}
                <button
                  onClick={(e) => { e.stopPropagation(); removeModule(i); }}
                  title="Remove module"
                  className="p-1 text-[#484F58] hover:text-red-400 rounded transition-colors flex-shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              {expandedModuleIdx === i && (
                <div className="p-3 space-y-2">
                  <input
                    value={m.description}
                    onChange={(e) => updateModule(i, "description", e.target.value)}
                    className="w-full bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors sm:hidden"
                    placeholder="Short description…"
                  />
                  <textarea
                    value={m.content}
                    onChange={(e) => updateModule(i, "content", e.target.value)}
                    rows={16}
                    spellCheck={false}
                    className="w-full bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-2 text-xs font-mono text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-y transition-colors"
                    placeholder="# PowerShell content…"
                  />
                </div>
              )}
            </div>
          ))}
          <button
            onClick={addModule}
            className="flex items-center gap-2 w-full px-3 py-2 border border-dashed border-[#30363D] rounded-lg text-xs text-[#7D8590] hover:text-[#E6EDF3] hover:border-[#484F58] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            Add module
          </button>
        </div>
      )}
    </div>
  );
}

function LibraryTab({
  token,
  scripts,
  packages,
  loading,
  onOpenScript,
  onDeleteScript,
  onDeletePackage,
  onUpdatePackage,
}: {
  token: string;
  scripts: PsScriptListItem[];
  packages: ScriptPackageListItem[];
  loading: boolean;
  onOpenScript: (id: string) => void;
  onDeleteScript: (id: string) => void;
  onDeletePackage: (id: string) => void;
  onUpdatePackage: (pkg: ScriptPackageListItem) => void;
}) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");

  const filtered = scripts.filter((s) => {
    const q = search.toLowerCase();
    const matchQ = !q || s.title.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q));
    const matchCat = catFilter === "all" || s.category === catFilter;
    return matchQ && matchCat;
  });

  const filteredPackages = packages.filter((p) => {
    const q = search.toLowerCase();
    const matchQ = !q || p.title.toLowerCase().includes(q) || p.modules.some((m) => m.filename.toLowerCase().includes(q));
    const matchCat = catFilter === "all" || p.category === catFilter;
    return matchQ && matchCat;
  });

  const usedCategories = [...new Set([...scripts.map((s) => s.category), ...packages.map((p) => p.category)])];
  const isEmpty = filtered.length === 0 && filteredPackages.length === 0;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#484F58]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search scripts and packages…"
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

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg className="w-10 h-10 text-[#30363D] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          <p className="text-sm text-[#7D8590]">
            {(scripts.length === 0 && packages.length === 0)
              ? "No scripts saved yet. Generate one in the Generator tab."
              : "No scripts match your search."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Script Packages */}
          {filteredPackages.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-[#7D8590] uppercase tracking-wide mb-2">Script Packages</h3>
              <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
                {filteredPackages.map((pkg) => (
                  <PackageRow key={pkg.id} pkg={pkg} token={token} onDeleted={onDeletePackage} onUpdated={onUpdatePackage} />
                ))}
              </div>
            </div>
          )}

          {/* Individual Scripts */}
          {filtered.length > 0 && (
            <div>
              {filteredPackages.length > 0 && (
                <h3 className="text-xs font-semibold text-[#7D8590] uppercase tracking-wide mb-2">Individual Scripts</h3>
              )}
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
            </div>
          )}
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
  const [packages, setPackages] = useState<ScriptPackageListItem[]>([]);
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
      const [list, pkgList] = await Promise.all([
        apiFetch("/admin/ps-scripts", token) as Promise<PsScriptListItem[]>,
        apiFetch("/admin/ps-scripts/packages", token) as Promise<ScriptPackageListItem[]>,
      ]);
      setScripts(list);
      setPackages(pkgList);
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

  const handleScriptUpdated = (s: PsScriptListItem) => {
    setScripts((prev) => prev.map((existing) => (existing.id === s.id ? s : existing)));
    setLibraryLoaded(true);
  };

  const handlePackageSaved = (p: ScriptPackageListItem) => {
    setPackages((prev) => [p, ...prev]);
    setLibraryLoaded(true);
  };

  const handlePackageUpdated = (p: ScriptPackageListItem) => {
    setPackages((prev) => prev.map((existing) => (existing.id === p.id ? p : existing)));
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

  const handleDeletePackage = (id: string) => {
    setPackages((prev) => prev.filter((p) => p.id !== id));
    toast({ title: "Package deleted" });
  };

  const handleLoadInEditor = (script: PsScriptDetail) => {
    setEditorScript(script);
    setOpenScriptId(null);
    setTab("generator");
  };

  const handleOpenScriptId = (id: string) => {
    setOpenScriptId(id);
  };

  const totalLibraryCount = scripts.length + packages.length;

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
            {t === "generator" ? "Generator" : `Library${totalLibraryCount > 0 ? ` (${totalLibraryCount})` : ""}`}
          </button>
        ))}
      </div>

      {/* Loaded-script banner — only visible when a library script is in the editor */}
      {tab === "generator" && editorScript && (
        <div className="flex items-center gap-2.5 px-3.5 py-2 bg-[#0078D4]/10 border border-[#0078D4]/25 rounded-xl text-sm">
          <svg className="w-3.5 h-3.5 text-[#58A6FF] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-[#7D8590] flex-shrink-0">Editing:</span>
          <span className="text-[#E6EDF3] font-medium truncate">{editorScript.title}</span>
          <button
            onClick={() => setEditorScript(null)}
            title="Clear — start a new script"
            className="ml-auto flex-shrink-0 p-0.5 rounded text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#30363D] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Tab content */}
      {tab === "generator" && (
        <GeneratorTab
          key={editorScript?.id ?? "new"}
          token={token}
          initialScript={editorScript}
          onScriptSaved={handleScriptSaved}
          onScriptUpdated={handleScriptUpdated}
          onPackageSaved={handlePackageSaved}
          baseInstructions={baseInstructions}
          onBaseInstructionsChange={handleBaseInstructionsChange}
        />
      )}
      {tab === "library" && (
        <LibraryTab
          token={token}
          scripts={scripts}
          packages={packages}
          loading={libraryLoading}
          onOpenScript={handleOpenScriptId}
          onDeleteScript={handleDeleteScript}
          onDeletePackage={handleDeletePackage}
          onUpdatePackage={handlePackageUpdated}
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
