import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { zipSync, strToU8 } from "fflate";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { StreamLanguage } from "@codemirror/language";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";

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
  azureRunbookName: string | null;
  azureSyncedAt: string | null;
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

const BASE_INSTRUCTIONS_KEY = "sg:baseInstructions";
const PROMPT_KEY = "sg:prompt";
const DETAILED_INSTRUCTIONS_KEY = "sg:detailedInstructions";
const CATEGORY_KEY = "sg:category";
const IDE_LEFT_WIDTH_KEY = "sg:ideLeftWidth";
const IDE_RIGHT_WIDTH_KEY = "sg:ideRightWidth";
const IDE_BOTTOM_HEIGHT_KEY = "sg:ideBottomHeight";
const IDE_LEFT_COLLAPSED_KEY = "sg:ideLeftCollapsed";
const IDE_RIGHT_VISIBLE_KEY = "sg:ideRightVisible";

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

function lsGet(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

// ─── Resize hook ──────────────────────────────────────────────────────────────

function useResize(key: string, def: number, min: number, max: number) {
  const [size, setSize] = useState(() => {
    const v = lsGet(key, String(def));
    const n = Number(v);
    return isNaN(n) ? def : Math.min(max, Math.max(min, n));
  });

  const persist = useCallback((v: number) => {
    const clamped = Math.min(max, Math.max(min, v));
    setSize(clamped);
    lsSet(key, String(clamped));
  }, [key, min, max]);

  return { size, persist };
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
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. List Teams with 100+ Members" className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#8B949E] mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional description…" className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors resize-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#8B949E] mb-1">Tags (comma-separated)</label>
            <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="e.g. teams, reporting, csv" className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors" />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={saving} className="flex-1 bg-[#0078D4] hover:bg-[#0086EF] disabled:opacity-50 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors">
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[#7D8590] hover:text-[#E6EDF3] border border-[#30363D] rounded-lg transition-colors">Cancel</button>
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
      <div className="bg-[#161B22] border border-[#30363D] h-full sm:h-full w-full sm:max-w-2xl flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D] flex-shrink-0">
          {script && <CategoryBadge category={script.category} />}
          <div className="flex items-center gap-2 ml-auto">
            {script && (
              <>
                <button onClick={handleCopy} title="Copy script" className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">
                  {copied ? <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button onClick={handleDownload} title="Download .ps1" className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  .ps1
                </button>
                <button onClick={() => onLoadInEditor(script)} className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-[#0078D4]/15 border border-[#0078D4]/30 text-[#58A6FF] hover:bg-[#0078D4]/25 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  Open in Editor
                </button>
                <button onClick={handleDelete} disabled={deleting} title="Delete script" className="p-1.5 text-[#7D8590] hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </>
            )}
            <button onClick={onClose} className="p-1.5 text-[#7D8590] hover:text-[#E6EDF3] rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        {loading && <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>}
        {script && !loading && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-[#E6EDF3]">{script.title}</h2>
              {script.description && <p className="text-sm text-[#8B949E] mt-1">{script.description}</p>}
              <p className="text-xs text-[#484F58] mt-1">Saved {formatDate(script.createdAt)}</p>
            </div>
            {script.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {script.tags.map((t) => <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-[#21262D] text-[#8B949E] border border-[#30363D]">{t}</span>)}
              </div>
            )}
            {(script.permissions.appPermissions.length > 0 || script.permissions.delegatedPermissions.length > 0 || script.permissions.notes) && (
              <div className="border border-[#30363D] rounded-lg overflow-hidden">
                <div className="px-4 py-3 space-y-3 bg-[#0D1117]">
                  {script.permissions.appPermissions.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-[#7D8590] uppercase tracking-wide mb-1.5">Application Permissions</p>
                      <div className="flex flex-wrap gap-1.5">{script.permissions.appPermissions.map((p) => <PermissionBadge key={p} text={p} />)}</div>
                    </div>
                  )}
                  {script.permissions.delegatedPermissions.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-[#7D8590] uppercase tracking-wide mb-1.5">Delegated Permissions</p>
                      <div className="flex flex-wrap gap-1.5">{script.permissions.delegatedPermissions.map((p) => <PermissionBadge key={p} text={p} />)}</div>
                    </div>
                  )}
                  {script.permissions.notes && <p className="text-xs text-[#8B949E] leading-relaxed border-t border-[#30363D] pt-2">{script.permissions.notes}</p>}
                </div>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-[#7D8590] uppercase tracking-wide mb-2">Script</p>
              <pre className="bg-[#0D1117] border border-[#30363D] rounded-lg p-4 text-xs text-[#C9D1D9] font-mono overflow-x-auto whitespace-pre leading-relaxed">{script.scriptBody}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Package Drawer ───────────────────────────────────────────────────────────

function PackageDrawer({
  pkg,
  token,
  onClose,
  onDeleted,
  onUpdated,
}: {
  pkg: ScriptPackageListItem;
  token: string;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onUpdated: (pkg: ScriptPackageListItem) => void;
}) {
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);
  const [activeModuleIdx, setActiveModuleIdx] = useState(0);

  const handleDelete = async () => {
    if (!confirm(`Delete package "${pkg.title}" and all its modules? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/admin/ps-scripts/packages/${pkg.id}`, token, { method: "DELETE" });
      onDeleted(pkg.id);
      onClose();
    } catch {
      toast({ title: "Failed to delete package", variant: "destructive" });
      setDeleting(false);
    }
  };

  const activeModule = pkg.modules[activeModuleIdx];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#161B22] border border-[#30363D] h-full w-full sm:max-w-2xl flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D] flex-shrink-0">
          <div className="flex items-center gap-2">
            <PackageBadge />
            <CategoryBadge category={pkg.category} />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => downloadAllModulesAsZip(pkg.modules, pkg.title)} className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download .zip
            </button>
            <button onClick={handleDelete} disabled={deleting} className="p-1.5 text-[#7D8590] hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
            <button onClick={onClose} className="p-1.5 text-[#7D8590] hover:text-[#E6EDF3] rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-[#E6EDF3]">{pkg.title}</h2>
            <p className="text-xs text-[#484F58] mt-1">{pkg.modules.length} modules · Saved {formatDate(pkg.createdAt)}</p>
          </div>
          {pkg.modules.length > 1 && (
            <div className="flex flex-wrap gap-1 bg-[#1C2128] border border-[#30363D] rounded-xl p-1">
              {pkg.modules.map((m, i) => (
                <button key={i} onClick={() => setActiveModuleIdx(i)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all truncate max-w-[180px] ${activeModuleIdx === i ? "bg-purple-500/15 text-purple-400 border border-purple-500/25" : "text-[#7D8590] hover:text-[#E6EDF3] border border-transparent"}`} title={m.filename}>
                  {m.filename}
                </button>
              ))}
            </div>
          )}
          {activeModule && (
            <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-[#1C2128] border-b border-[#30363D]">
                <span className="text-xs font-mono text-[#7D8590]">{activeModule.filename}</span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => { copyToClipboard(activeModule.content); }} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">Copy</button>
                  <button onClick={() => downloadFile(activeModule.content, activeModule.filename)} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">Download</button>
                </div>
              </div>
              <pre className="bg-[#0D1117] text-[#C9D1D9] font-mono text-xs leading-relaxed p-4 overflow-x-auto whitespace-pre" style={{ fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace" }}>{activeModule.content}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Module Package View (center pane — after modularize) ─────────────────────

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
    copyToClipboard(modules[idx]!.content);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#30363D] bg-[#161B22] flex-shrink-0">
        <div className="flex items-center gap-2">
          <PackageBadge />
          <span className="text-sm font-medium text-[#E6EDF3] truncate">{packageTitle}</span>
          <span className="text-xs text-[#7D8590]">— {modules.length} modules</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => downloadAllModulesAsZip(modules, packageTitle)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 hover:bg-purple-500/25 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Download All (.zip)
          </button>
          <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Back to editor
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 px-4 py-2 bg-[#0D1117] border-b border-[#30363D] flex-shrink-0">
        {modules.map((m, i) => (
          <button key={i} onClick={() => setActiveIdx(i)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all truncate max-w-[180px] ${activeIdx === i ? "bg-purple-500/15 text-purple-400 border border-purple-500/25" : "text-[#7D8590] hover:text-[#E6EDF3] border border-transparent"}`} title={m.filename}>
            {m.filename}
          </button>
        ))}
      </div>
      {activeModule && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-2 bg-[#161B22] border-b border-[#30363D] flex-shrink-0">
            <span className="text-xs font-mono text-[#7D8590]">{activeModule.filename}</span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => handleCopy(activeIdx)} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">
                {copiedIdx === activeIdx ? <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                {copiedIdx === activeIdx ? "Copied!" : "Copy"}
              </button>
              <button onClick={() => downloadFile(activeModule.content, activeModule.filename)} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download
              </button>
            </div>
          </div>
          <pre className="flex-1 bg-[#0D1117] text-[#C9D1D9] font-mono text-xs leading-relaxed p-4 overflow-auto whitespace-pre" style={{ fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace" }}>
            {activeModule.content}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Library Sidebar ──────────────────────────────────────────────────────────

function LibrarySidebar({
  scripts,
  packages,
  loading,
  collapsed,
  onToggleCollapse,
  onOpenScript,
  onOpenPackage,
  loadingScriptId,
}: {
  scripts: PsScriptListItem[];
  packages: ScriptPackageListItem[];
  loading: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenScript: (id: string) => void;
  onOpenPackage: (pkg: ScriptPackageListItem) => void;
  loadingScriptId: string | null;
}) {
  const [search, setSearch] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const q = search.toLowerCase();

  const filteredScripts = scripts.filter((s) =>
    !q || s.title.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
  );

  const filteredPackages = packages.filter((p) =>
    !q || p.title.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
  );

  type GroupEntry = { type: "script"; item: PsScriptListItem } | { type: "package"; item: ScriptPackageListItem };
  const grouped: Record<string, GroupEntry[]> = {};

  for (const s of filteredScripts) {
    const cat = s.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ type: "script", item: s });
  }
  for (const p of filteredPackages) {
    const cat = p.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ type: "package", item: p });
  }

  const catKeys = Object.keys(grouped).sort((a, b) => {
    const ai = CATEGORIES.findIndex((c) => c.value === a);
    const bi = CATEGORIES.findIndex((c) => c.value === b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const toggleCat = (cat: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-3 gap-2 border-r border-[#21262D] bg-[#0D1117]" style={{ width: 40 }}>
        <button onClick={onToggleCollapse} title="Expand library" className="p-1.5 text-[#484F58] hover:text-[#E6EDF3] rounded transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
        <div className="w-px flex-1 bg-[#21262D]" />
        <span className="text-[9px] text-[#484F58] font-semibold tracking-widest" style={{ writingMode: "vertical-rl" }}>LIBRARY</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col border-r border-[#21262D] bg-[#0D1117] overflow-hidden" style={{ width: "100%" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#21262D] flex-shrink-0">
        <span className="text-[10px] font-semibold text-[#484F58] uppercase tracking-widest">Library</span>
        <button onClick={onToggleCollapse} title="Collapse library" className="p-1 text-[#484F58] hover:text-[#E6EDF3] rounded transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-2 flex-shrink-0 border-b border-[#21262D]">
        <div className="relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#484F58]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter…" className="w-full bg-[#161B22] border border-[#30363D] rounded pl-6 pr-2 py-1 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/50 transition-colors" />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && catKeys.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-[#484F58]">{(scripts.length === 0 && packages.length === 0) ? "No scripts saved yet" : "No results"}</p>
          </div>
        )}

        {!loading && catKeys.map((cat) => {
          const entries = grouped[cat] ?? [];
          const isCatCollapsed = collapsedCats.has(cat);
          return (
            <div key={cat}>
              <button
                onClick={() => toggleCat(cat)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-[#161B22] transition-colors group"
              >
                <svg className={`w-3 h-3 text-[#484F58] flex-shrink-0 transition-transform ${isCatCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                <span className="flex-1 text-left text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide truncate">{CATEGORY_MAP[cat] ?? cat}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#21262D] text-[#484F58] border border-[#30363D] flex-shrink-0">{entries.length}</span>
              </button>
              {!isCatCollapsed && entries.map((entry, i) => {
                if (entry.type === "script") {
                  const s = entry.item;
                  const isLoading = loadingScriptId === s.id;
                  return (
                    <button
                      key={`s-${s.id}`}
                      onClick={() => onOpenScript(s.id)}
                      className="w-full flex items-center gap-2 pl-7 pr-3 py-1 hover:bg-[#161B22] transition-colors group text-left"
                      title={s.title}
                    >
                      {isLoading ? (
                        <div className="w-3 h-3 border border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      ) : (
                        <svg className="w-3 h-3 text-[#484F58] group-hover:text-[#58A6FF] flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      )}
                      <span className="flex-1 text-xs text-[#C9D1D9] truncate">{s.title}</span>
                    </button>
                  );
                } else {
                  const p = entry.item;
                  return (
                    <button
                      key={`p-${p.id}-${i}`}
                      onClick={() => onOpenPackage(p)}
                      className="w-full flex items-center gap-2 pl-7 pr-3 py-1 hover:bg-[#161B22] transition-colors group text-left"
                      title={p.title}
                    >
                      <svg className="w-3 h-3 text-purple-500/70 group-hover:text-purple-400 flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                      <span className="flex-1 text-xs text-[#C9D1D9] truncate">{p.title}</span>
                      <span className="text-[9px] text-purple-500/60 flex-shrink-0">{p.modules.length}m</span>
                    </button>
                  );
                }
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Right Permissions Sidebar ────────────────────────────────────────────────

function PermissionsSidebarPanel({ permissions }: { permissions: PsScriptPermissions | null }) {
  const totalCount = permissions
    ? permissions.appPermissions.length + permissions.delegatedPermissions.length
    : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-[#21262D] bg-[#0D1117]">
      <div className="px-4 py-2.5 border-b border-[#21262D] flex-shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
          <span className="text-[10px] font-semibold text-[#484F58] uppercase tracking-widest">Permissions</span>
        </div>
        {totalCount > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">{totalCount}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {!permissions || (!permissions.appPermissions.length && !permissions.delegatedPermissions.length && !permissions.notes) ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
            <svg className="w-8 h-8 text-[#21262D] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
            <p className="text-[11px] text-[#484F58] leading-relaxed">Generate or load a script to see required permissions</p>
          </div>
        ) : (
          <div className="space-y-3">
            {permissions.appPermissions.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wide mb-1.5">Application</p>
                <div className="flex flex-wrap gap-1">
                  {permissions.appPermissions.map((p) => <PermissionBadge key={p} text={p} />)}
                </div>
              </div>
            )}
            {permissions.delegatedPermissions.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wide mb-1.5">Delegated</p>
                <div className="flex flex-wrap gap-1">
                  {permissions.delegatedPermissions.map((p) => <PermissionBadge key={p} text={p} />)}
                </div>
              </div>
            )}
            {permissions.notes && (
              <p className="text-[11px] text-[#7D8590] leading-relaxed border-t border-[#21262D] pt-2">{permissions.notes}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bottom Panel ─────────────────────────────────────────────────────────────

type BottomTab = "prompt" | "bugfix" | "instructions";

function BottomPanel({
  category,
  onCategoryChange,
  prompt,
  onPromptChange,
  detailedInstructions,
  onDetailedInstructionsChange,
  baseInstructions,
  onBaseInstructionsChange,
  bugDescription,
  onBugDescriptionChange,
  generating,
  fixing,
  summaryError,
  fixSummary,
  onGenerate,
  onFixBug,
  onDismissSummaryError,
  onDismissFixSummary,
  activeTab,
  onActiveTabChange,
}: {
  category: string;
  onCategoryChange: (v: string) => void;
  prompt: string;
  onPromptChange: (v: string) => void;
  detailedInstructions: string;
  onDetailedInstructionsChange: (v: string) => void;
  baseInstructions: string;
  onBaseInstructionsChange: (v: string) => void;
  bugDescription: string;
  onBugDescriptionChange: (v: string) => void;
  generating: boolean;
  fixing: boolean;
  summaryError: "generate" | "fix" | null;
  fixSummary: string;
  onGenerate: () => void;
  onFixBug: () => void;
  onDismissSummaryError: () => void;
  onDismissFixSummary: () => void;
  activeTab: BottomTab;
  onActiveTabChange: (t: BottomTab) => void;
}) {
  const setActiveTab = onActiveTabChange;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0D1117] border-t border-[#21262D]">
      {/* Tab strip */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#21262D] flex-shrink-0 bg-[#161B22]">
        {(["prompt", "bugfix", "instructions"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${activeTab === t ? "bg-[#0078D4]/15 text-[#58A6FF] border border-[#0078D4]/25" : "text-[#7D8590] hover:text-[#E6EDF3] border border-transparent"}`}
          >
            {t === "prompt" ? "Prompt" : t === "bugfix" ? "Bug Fix" : "Custom Instructions"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Summary-error retry banner */}
        {summaryError && (
          <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2.5">
            <svg className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-amber-400 mb-0.5">AI returned a summary instead of a script</p>
              <p className="text-[11px] text-amber-300/70">{summaryError === "generate" ? "The model described the script instead of writing it. Your editor is unchanged." : "The model described the fix. Your original script has not been modified."}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button onClick={summaryError === "generate" ? onGenerate : onFixBug} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-colors">Retry</button>
              <button onClick={onDismissSummaryError} className="p-1 text-amber-400/50 hover:text-amber-400 rounded transition-colors"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
          </div>
        )}

        {/* Fix summary callout */}
        {fixSummary && (
          <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2.5">
            <svg className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-green-400 mb-0.5">Bug fixed</p>
              <p className="text-[11px] text-green-300/80">{fixSummary}</p>
            </div>
            <button onClick={onDismissFixSummary} className="text-green-400/50 hover:text-green-400 flex-shrink-0 rounded p-0.5 transition-colors"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        )}

        {activeTab === "prompt" && (
          <>
            <div>
              <label className="block text-[10px] font-medium text-[#7D8590] mb-1">Category</label>
              <select value={category} onChange={(e) => onCategoryChange(e.target.value)} className="w-full bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 transition-colors">
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-[#7D8590] mb-1">Describe what you need</label>
              <textarea
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                rows={3}
                placeholder="e.g. List all Teams with more than 100 members and export to CSV with owner names, member count, and creation date…"
                className="w-full bg-[#161B22] border border-[#30363D] rounded px-2.5 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors resize-none"
              />
            </div>
            <button onClick={onGenerate} disabled={generating} className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#0086EF] disabled:opacity-50 text-white text-xs font-semibold py-1.5 px-4 rounded transition-colors">
              {generating ? <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Generating…</> : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Generate Script</>}
            </button>
          </>
        )}

        {activeTab === "bugfix" && (
          <>
            <p className="text-[11px] text-[#7D8590] leading-relaxed">Describe what's wrong and Claude will return a corrected version.</p>
            <div>
              <label className="block text-[10px] font-medium text-[#7D8590] mb-1">Bug description</label>
              <textarea
                value={bugDescription}
                onChange={(e) => onBugDescriptionChange(e.target.value)}
                rows={4}
                placeholder="e.g. The filter for disabled accounts isn't working — it's returning all users instead of only disabled ones…"
                className="w-full bg-[#161B22] border border-[#30363D] rounded px-2.5 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-amber-500/50 transition-colors resize-none"
              />
            </div>
            <button onClick={onFixBug} disabled={fixing || !bugDescription.trim()} className="flex items-center gap-2 bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-50 border border-amber-500/30 text-amber-400 text-xs font-semibold py-1.5 px-4 rounded transition-colors">
              {fixing ? <><div className="w-3.5 h-3.5 border-2 border-amber-400/40 border-t-amber-400 rounded-full animate-spin" />Fixing…</> : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Fix with Claude</>}
            </button>
          </>
        )}

        {activeTab === "instructions" && (
          <>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-medium text-[#7D8590]">Base Instructions</label>
                <span className="text-[9px] text-[#484F58] bg-[#161B22] border border-[#21262D] rounded px-1.5 py-0.5">Applied to every generation</span>
              </div>
              <textarea
                value={baseInstructions}
                onChange={(e) => onBaseInstructionsChange(e.target.value)}
                rows={3}
                placeholder="e.g. Always use the PnP PowerShell module. Follow Microsoft best practices. Include error handling and verbose logging…"
                className="w-full bg-[#161B22] border border-[#30363D] rounded px-2.5 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors resize-none"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-medium text-[#7D8590]">Detailed Instructions</label>
                <span className="text-[9px] text-[#484F58] bg-[#161B22] border border-[#21262D] rounded px-1.5 py-0.5">This generation only</span>
              </div>
              <textarea
                value={detailedInstructions}
                onChange={(e) => onDetailedInstructionsChange(e.target.value)}
                rows={3}
                placeholder="e.g. The tenant uses a hybrid setup — avoid any commands that require cloud-only connectivity…"
                className="w-full bg-[#161B22] border border-[#30363D] rounded px-2.5 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors resize-none"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ScriptGeneratorPage() {
  const { accessToken } = useAuth();
  const token = accessToken ?? "";
  const { toast } = useToast();

  // ── Generator state ─────────────────────────────────────────────────────────
  const [category, setCategory] = useState(() => lsGet(CATEGORY_KEY, "m365"));
  const [prompt, setPrompt] = useState(() => lsGet(PROMPT_KEY, ""));
  const [detailedInstructions, setDetailedInstructions] = useState(() => lsGet(DETAILED_INSTRUCTIONS_KEY, ""));
  const [baseInstructions, setBaseInstructions] = useState(() => lsGet(BASE_INSTRUCTIONS_KEY, ""));
  const [scriptBody, setScriptBody] = useState("");
  const [permissions, setPermissions] = useState<PsScriptPermissions>({ appPermissions: [], delegatedPermissions: [], notes: "" });
  const [generating, setGenerating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [modularizing, setModularizing] = useState(false);
  const [fixing, setFixing] = useState(false);
  // Tracks the "clean" saved/generated body to compute dirty state
  const cleanBodyRef = useRef("");
  // Bottom panel tab controlled from parent so the Fix Bug toolbar button can switch it
  const [bottomActiveTab, setBottomActiveTab] = useState<BottomTab>("prompt");
  const [copied, setCopied] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [bugDescription, setBugDescription] = useState("");
  const [fixSummary, setFixSummary] = useState("");
  const [summaryError, setSummaryError] = useState<"generate" | "fix" | null>(null);
  const [modules, setModules] = useState<ScriptModuleItem[]>([]);
  const [editorScript, setEditorScript] = useState<PsScriptDetail | null>(null);

  // ── Library state ───────────────────────────────────────────────────────────
  const [scripts, setScripts] = useState<PsScriptListItem[]>([]);
  const [packages, setPackages] = useState<ScriptPackageListItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [loadingScriptId, setLoadingScriptId] = useState<string | null>(null);
  const [openDrawerScriptId, setOpenDrawerScriptId] = useState<string | null>(null);
  const [openDrawerPackage, setOpenDrawerPackage] = useState<ScriptPackageListItem | null>(null);

  // ── IDE panel layout state ───────────────────────────────────────────────────
  const leftPanel = useResize(IDE_LEFT_WIDTH_KEY, 240, 140, 400);
  const rightPanel = useResize(IDE_RIGHT_WIDTH_KEY, 260, 160, 420);
  const bottomPanel = useResize(IDE_BOTTOM_HEIGHT_KEY, 220, 100, 450);

  const [leftCollapsed, setLeftCollapsed] = useState(() => lsGet(IDE_LEFT_COLLAPSED_KEY, "false") === "true");
  const [rightVisible, setRightVisible] = useState(() => lsGet(IDE_RIGHT_VISIBLE_KEY, "true") === "true");

  // Drag state refs
  const isDraggingLeft = useRef(false);
  const isDraggingRight = useRef(false);
  const isDraggingBottom = useRef(false);

  // ── Load library on mount ────────────────────────────────────────────────────
  const loadLibrary = useCallback(async () => {
    if (libraryLoaded) return;
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
  }, [libraryLoaded, token, toast]);

  useEffect(() => { void loadLibrary(); }, [loadLibrary]);

  // ── Panel resize handlers ────────────────────────────────────────────────────
  const startLeftResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftPanel.size;
    isDraggingLeft.current = true;

    const onMove = (ev: MouseEvent) => {
      const newW = startW + ev.clientX - startX;
      leftPanel.persist(newW);
    };
    const onUp = () => {
      isDraggingLeft.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [leftPanel]);

  const startRightResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightPanel.size;
    isDraggingRight.current = true;

    const onMove = (ev: MouseEvent) => {
      const newW = startW - (ev.clientX - startX);
      rightPanel.persist(newW);
    };
    const onUp = () => {
      isDraggingRight.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [rightPanel]);

  const startBottomResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = bottomPanel.size;
    isDraggingBottom.current = true;

    const onMove = (ev: MouseEvent) => {
      const newH = startH - (ev.clientY - startY);
      bottomPanel.persist(newH);
    };
    const onUp = () => {
      isDraggingBottom.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [bottomPanel]);

  // ── Toggle helpers ────────────────────────────────────────────────────────────
  const toggleLeftCollapsed = () => {
    const next = !leftCollapsed;
    setLeftCollapsed(next);
    lsSet(IDE_LEFT_COLLAPSED_KEY, String(next));
  };

  const toggleRightVisible = () => {
    const next = !rightVisible;
    setRightVisible(next);
    lsSet(IDE_RIGHT_VISIBLE_KEY, String(next));
  };

  // ── Persist prompt fields ─────────────────────────────────────────────────────
  const handleCategoryChange = (v: string) => { setCategory(v); lsSet(CATEGORY_KEY, v); };
  const handlePromptChange = (v: string) => { setPrompt(v); lsSet(PROMPT_KEY, v); };
  const handleDetailedInstructionsChange = (v: string) => { setDetailedInstructions(v); lsSet(DETAILED_INSTRUCTIONS_KEY, v); };
  const handleBaseInstructionsChange = (v: string) => { setBaseInstructions(v); lsSet(BASE_INSTRUCTIONS_KEY, v); };

  // ── API actions ───────────────────────────────────────────────────────────────
  const generate = async () => {
    if (!prompt.trim()) { toast({ title: "Enter a description first", variant: "destructive" }); return; }
    setGenerating(true);
    setModules([]);
    setFixSummary("");
    setSummaryError(null);
    try {
      const result = await apiFetch("/admin/ps-scripts/generate", token, {
        method: "POST",
        body: JSON.stringify({ prompt: prompt.trim(), category, baseInstructions: baseInstructions.trim() || undefined, detailedInstructions: detailedInstructions.trim() || undefined }),
      }) as { script: string; permissions: PsScriptPermissions };
      if (!result.script || result.script.trim().length < 20) {
        toast({ title: "Generation could not be applied", description: "The AI returned an unreadable response.", variant: "destructive" });
        return;
      }
      setScriptBody(result.script);
      cleanBodyRef.current = result.script;
      setPermissions(result.permissions);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      if (msg.toLowerCase().includes("summary instead of a script")) setSummaryError("generate");
      else toast({ title: "Generation failed", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const fixBug = async () => {
    if (!bugDescription.trim()) { toast({ title: "Describe the bug first", variant: "destructive" }); return; }
    setFixing(true);
    setFixSummary("");
    setSummaryError(null);
    try {
      const result = await apiFetch("/admin/ps-scripts/fix", token, {
        method: "POST",
        body: JSON.stringify({ scriptContent: scriptBody, bugDescription: bugDescription.trim(), customInstructions: baseInstructions.trim() || undefined }),
      }) as { fixedScript: string; fixSummary: string; permissions: PsScriptPermissions };
      if (!result.fixedScript || result.fixedScript.trim().length < 20) {
        toast({ title: "Fix could not be applied", description: "The AI returned an unreadable response. Your original script has not been changed.", variant: "destructive" });
        return;
      }
      setScriptBody(result.fixedScript);
      cleanBodyRef.current = result.fixedScript;
      setPermissions(result.permissions);
      setFixSummary(result.fixSummary);
      setBugDescription("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      if (msg.toLowerCase().includes("summary instead of a script")) setSummaryError("fix");
      else toast({ title: "Fix failed", description: msg, variant: "destructive" });
    } finally {
      setFixing(false);
    }
  };

  const modularize = async () => {
    setModularizing(true);
    try {
      const result = await apiFetch("/admin/ps-scripts/modularize", token, {
        method: "POST",
        body: JSON.stringify({ scriptContent: scriptBody, title: prompt.trim() || "Modular Package", category, customInstructions: baseInstructions.trim() || undefined }),
      }) as { packageId: string; title: string; modules: ScriptModuleItem[] };
      setModules(result.modules);
      const pkg: ScriptPackageListItem = { id: result.packageId, title: result.title, category, permissions, tags: [], createdAt: new Date().toISOString(), modules: result.modules };
      setPackages((prev) => [pkg, ...prev]);
      setLibraryLoaded(true);
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
    if (!editorScript?.id || !scriptBody) return;
    setUpdating(true);
    try {
      const updated = await apiFetch(`/admin/ps-scripts/${editorScript.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ scriptBody, permissions }),
      }) as PsScriptListItem;
      cleanBodyRef.current = scriptBody;
      setScripts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      toast({ title: "Library entry updated" });
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  };

  const pushToAzure = async () => {
    if (!editorScript?.id) return;
    try {
      const data = await apiFetch(`/admin/ps-scripts/${editorScript.id}/push-to-azure`, token, { method: "POST" }) as { ok: boolean; warning?: string; azureSyncedAt?: string } | null;
      if (data && !data.ok && data.warning) toast({ title: data.warning });
      else toast({ title: "Pushed to Azure Automation" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Push to Azure failed", variant: "destructive" });
    }
  };

  // ── Library event handlers ────────────────────────────────────────────────────
  const handleSidebarScriptClick = async (id: string) => {
    setLoadingScriptId(id);
    try {
      const detail = await apiFetch(`/admin/ps-scripts/${id}`, token) as PsScriptDetail;
      setEditorScript(detail);
      setScriptBody(detail.scriptBody);
      cleanBodyRef.current = detail.scriptBody;
      setPermissions(detail.permissions);
      setModules([]);
      setFixSummary("");
      setSummaryError(null);
    } catch {
      toast({ title: "Failed to load script", variant: "destructive" });
    } finally {
      setLoadingScriptId(null);
    }
  };

  const handleScriptSaved = (s: PsScriptListItem) => {
    setScripts((prev) => [s, ...prev]);
    setLibraryLoaded(true);
    setShowSaveModal(false);
    toast({ title: "Script saved to library" });
  };

  const handleDeleteScript = async (id: string) => {
    if (!confirm("Delete this script? This cannot be undone.")) return;
    try {
      await apiFetch(`/admin/ps-scripts/${id}`, token, { method: "DELETE" });
      setScripts((prev) => prev.filter((s) => s.id !== id));
      if (editorScript?.id === id) { setEditorScript(null); }
      toast({ title: "Script deleted" });
    } catch {
      toast({ title: "Failed to delete script", variant: "destructive" });
    }
  };

  const handleDeletePackage = (id: string) => {
    setPackages((prev) => prev.filter((p) => p.id !== id));
    if (openDrawerPackage?.id === id) setOpenDrawerPackage(null);
    toast({ title: "Package deleted" });
  };

  const handleLoadInEditor = (script: PsScriptDetail) => {
    setEditorScript(script);
    setScriptBody(script.scriptBody);
    cleanBodyRef.current = script.scriptBody;
    setPermissions(script.permissions);
    setModules([]);
    setFixSummary("");
    setSummaryError(null);
    setOpenDrawerScriptId(null);
  };

  // ── Computed values ───────────────────────────────────────────────────────────
  const tabLabel = editorScript ? editorScript.title : "Untitled — New Script";
  // Dirty when the current body diverges from the last saved/generated/loaded baseline
  const isUnsaved = scriptBody.length > 0 && scriptBody !== cleanBodyRef.current;
  const effectiveLeftWidth = leftCollapsed ? 40 : leftPanel.size;
  // Show permissions only when a script is loaded/typed (not "empty canvas" state)
  const scriptLoaded = scriptBody.length > 0;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0D1117]">
      {/* ── IDE body ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ── Left panel ──────────────────────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden flex-shrink-0" style={{ width: effectiveLeftWidth }}>
          <LibrarySidebar
            scripts={scripts}
            packages={packages}
            loading={libraryLoading}
            collapsed={leftCollapsed}
            onToggleCollapse={toggleLeftCollapsed}
            onOpenScript={handleSidebarScriptClick}
            onOpenPackage={(pkg) => setOpenDrawerPackage(pkg)}
            loadingScriptId={loadingScriptId}
          />
        </div>

        {/* Left resize handle */}
        {!leftCollapsed && (
          <div
            onMouseDown={startLeftResize}
            className="w-1 cursor-col-resize bg-[#21262D] hover:bg-[#0078D4]/50 transition-colors flex-shrink-0"
            title="Drag to resize"
          />
        )}

        {/* ── Center + bottom ──────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Center editor pane */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Tab bar */}
            <div className="flex items-center bg-[#161B22] border-b border-[#21262D] flex-shrink-0 px-3 gap-2" style={{ minHeight: 38 }}>
              {/* Tab / script name */}
              <div className="flex items-center gap-1.5 min-w-0 mr-auto">
                <svg className="w-3.5 h-3.5 text-[#58A6FF] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                <span className="text-xs font-medium text-[#E6EDF3] truncate max-w-xs">{tabLabel}</span>
                {isUnsaved && <span className="w-1.5 h-1.5 rounded-full bg-[#E6EDF3]/50 flex-shrink-0" title="Unsaved changes" />}
                {editorScript && (
                  <button
                    onClick={() => { setEditorScript(null); setScriptBody(""); cleanBodyRef.current = ""; setPermissions({ appPermissions: [], delegatedPermissions: [], notes: "" }); setModules([]); }}
                    title="Clear — start a new script"
                    className="p-0.5 text-[#484F58] hover:text-[#E6EDF3] rounded transition-colors flex-shrink-0"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>

              {/* Toolbar buttons */}
              {scriptBody && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={handleCopy} title="Copy to clipboard" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">
                    {copied ? <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button onClick={handleDownload} title="Download .ps1 file" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    .ps1
                  </button>
                  <button
                    onClick={() => { setBottomActiveTab("bugfix"); }}
                    disabled={fixing}
                    title="Fix a bug in this script"
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                  >
                    {fixing ? <div className="w-3 h-3 border border-red-400/40 border-t-red-400 rounded-full animate-spin" /> : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>}
                    {fixing ? "Fixing…" : "Fix Bug"}
                  </button>
                  <button onClick={modularize} disabled={modularizing} title="Decompose into modules" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 disabled:opacity-50 transition-colors">
                    {modularizing ? <div className="w-3 h-3 border border-purple-400/40 border-t-purple-400 rounded-full animate-spin" /> : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}
                    {modularizing ? "Modularizing…" : "Modularize"}
                  </button>
                  {editorScript?.id && (
                    <button onClick={updateSavedCopy} disabled={updating} title="Push current script & permissions back to the saved library entry" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 disabled:opacity-50 transition-colors">
                      {updating ? <div className="w-3 h-3 border border-green-400/40 border-t-green-400 rounded-full animate-spin" /> : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
                      {updating ? "Updating…" : "Update"}
                    </button>
                  )}
                  {editorScript?.id && (
                    <button onClick={pushToAzure} title="Push to Azure Automation" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-[#0078D4]/30 bg-[#0078D4]/10 text-[#58A6FF] hover:bg-[#0078D4]/20 transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                      Azure
                    </button>
                  )}
                  <button onClick={() => setShowSaveModal(true)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-[#0078D4]/15 border border-[#0078D4]/30 text-[#58A6FF] hover:bg-[#0078D4]/25 transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                    Save
                  </button>
                </div>
              )}

              {/* Right panel toggle */}
              <button
                onClick={toggleRightVisible}
                title={rightVisible ? "Hide permissions panel" : "Show permissions panel"}
                className={`ml-1 p-1.5 rounded transition-colors flex-shrink-0 ${rightVisible ? "text-amber-400 bg-amber-500/10" : "text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
              </button>
            </div>

            {/* Editor body */}
            {modules.length > 0 ? (
              <ModulePackageView modules={modules} packageTitle={prompt.trim() || "package"} onBack={() => setModules([])} />
            ) : (
              <div className="flex-1 min-h-0 relative">
                {(generating || modularizing) && (
                  <div className="absolute inset-0 bg-[#0D1117]/80 flex flex-col items-center justify-center z-10 gap-3">
                    <div className="w-8 h-8 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs text-[#7D8590]">{generating ? "Generating script…" : "Modularizing…"}</p>
                  </div>
                )}
                <CodeMirror
                  value={scriptBody}
                  onChange={(val) => setScriptBody(val)}
                  extensions={[StreamLanguage.define(powerShell)]}
                  theme={oneDark}
                  basicSetup={{
                    lineNumbers: true,
                    highlightActiveLine: true,
                    highlightActiveLineGutter: true,
                    foldGutter: true,
                    autocompletion: false,
                  }}
                  placeholder="# PowerShell script will appear here after generation, or paste/type directly…"
                  height="100%"
                  style={{
                    height: "100%",
                    fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
                    fontSize: "12px",
                  }}
                />
              </div>
            )}
          </div>

          {/* Bottom resize handle */}
          <div
            onMouseDown={startBottomResize}
            className="h-1 cursor-row-resize bg-[#21262D] hover:bg-[#0078D4]/50 transition-colors flex-shrink-0"
            title="Drag to resize"
          />

          {/* Bottom panel */}
          <div className="flex-shrink-0 overflow-hidden" style={{ height: bottomPanel.size }}>
            <BottomPanel
              category={category}
              onCategoryChange={handleCategoryChange}
              prompt={prompt}
              onPromptChange={handlePromptChange}
              detailedInstructions={detailedInstructions}
              onDetailedInstructionsChange={handleDetailedInstructionsChange}
              baseInstructions={baseInstructions}
              onBaseInstructionsChange={handleBaseInstructionsChange}
              bugDescription={bugDescription}
              onBugDescriptionChange={setBugDescription}
              generating={generating}
              fixing={fixing}
              summaryError={summaryError}
              fixSummary={fixSummary}
              onGenerate={generate}
              onFixBug={fixBug}
              onDismissSummaryError={() => setSummaryError(null)}
              onDismissFixSummary={() => setFixSummary("")}
              activeTab={bottomActiveTab}
              onActiveTabChange={setBottomActiveTab}
            />
          </div>
        </div>

        {/* Right resize handle */}
        {rightVisible && (
          <div
            onMouseDown={startRightResize}
            className="w-1 cursor-col-resize bg-[#21262D] hover:bg-[#0078D4]/50 transition-colors flex-shrink-0"
            title="Drag to resize"
          />
        )}

        {/* ── Right panel ──────────────────────────────────────────────────── */}
        {rightVisible && (
          <div className="flex-shrink-0 overflow-hidden" style={{ width: rightPanel.size }}>
            <PermissionsSidebarPanel permissions={scriptLoaded ? permissions : null} />
          </div>
        )}
      </div>

      {/* ── Modals & Drawers ──────────────────────────────────────────────── */}
      {showSaveModal && (
        <SaveModal
          scriptBody={scriptBody}
          permissions={permissions}
          category={category}
          token={token}
          onSaved={handleScriptSaved}
          onClose={() => setShowSaveModal(false)}
        />
      )}

      {openDrawerScriptId !== null && (
        <ScriptDrawer
          scriptId={openDrawerScriptId}
          token={token}
          onClose={() => setOpenDrawerScriptId(null)}
          onLoadInEditor={handleLoadInEditor}
          onDeleted={(id) => {
            handleDeleteScript(id);
            setOpenDrawerScriptId(null);
          }}
        />
      )}

      {openDrawerPackage !== null && (
        <PackageDrawer
          pkg={openDrawerPackage}
          token={token}
          onClose={() => setOpenDrawerPackage(null)}
          onDeleted={(id) => {
            handleDeletePackage(id);
            setOpenDrawerPackage(null);
          }}
          onUpdated={(updated) => {
            setPackages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            setOpenDrawerPackage(updated);
          }}
        />
      )}
    </div>
  );
}
