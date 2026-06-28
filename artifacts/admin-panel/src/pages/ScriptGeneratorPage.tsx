import { useState, useCallback, useEffect, useRef } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AzurePushDialog, type AzurePushDialogState } from "@/components/AzurePushDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import CatalogSidebarPanel from "@/components/CatalogSidebarPanel";
import RunResultsSidebarPanel from "@/components/RunResultsSidebarPanel";
import type { RunResult } from "@/components/RunResultsSidebarPanel";
import RunResultDetailPanel from "@/components/RunResultDetailPanel";
import { zipSync, strToU8 } from "fflate";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { StreamLanguage } from "@codemirror/language";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { powershellExtensions } from "@/lib/powershell-completions";

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

interface ServiceListItem {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  tier: string | null;
  workflowTemplateId: number | null;
  deliverables: string[];
  inclusions: string[];
  features: string[];
}

interface WorkflowTemplateStep {
  id: number;
  title: string;
  description: string | null;
  order: number;
  tasks: Array<{ id: number; title: string; description: string | null }>;
}

interface WorkflowTemplateDetail {
  id: number;
  name: string;
  description: string | null;
  steps: WorkflowTemplateStep[];
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
const IDE_RIGHT_TAB_KEY = "sg:ideRightTab";
const IDE_LEFT_MODE_KEY = "sg:ideLeftMode";

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

interface EditableModule extends ScriptModuleItem {
  _key: string;
}

let _editKeyCounter = 0;
function makeEditKey() { return `emod-${++_editKeyCounter}`; }

function PackageDrawerPushButton({ packageId, token, moduleCount }: { packageId: string; token: string; moduleCount: number }) {
  const { toast } = useToast();
  const [pushing, setPushing] = useState(false);

  const handlePush = async () => {
    setPushing(true);
    try {
      type PushApiResult = { ok: boolean; warning?: string; results?: { filename: string; ok: boolean; error?: string }[] };
      const data = (await apiFetch(`/admin/ps-scripts/packages/${packageId}/push-to-azure`, token, { method: "POST" })) as PushApiResult;
      if (data.warning) { toast({ title: "Azure push skipped", description: data.warning }); return; }
      const failed = (data.results ?? []).filter((r) => !r.ok);
      if (failed.length === 0) {
        toast({ title: "All modules pushed to Azure", description: `${moduleCount} runbook(s) created/updated` });
      } else {
        toast({ title: `${failed.length} module(s) failed`, description: failed.map((f) => `${f.filename}: ${f.error ?? "unknown"}`).join(" | "), variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Push failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setPushing(false);
    }
  };

  return (
    <button
      onClick={handlePush}
      disabled={pushing}
      className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#0078D4]/35 bg-[#0078D4]/10 text-[#58A6FF] hover:bg-[#0078D4]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title="Push each module as its own Azure Automation runbook"
    >
      {pushing ? (
        <><div className="w-3.5 h-3.5 border-2 border-[#58A6FF]/40 border-t-[#58A6FF] rounded-full animate-spin" />Pushing…</>
      ) : (
        <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>Push to Azure</>
      )}
    </button>
  );
}

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

  // ── Edit mode state ──────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editModules, setEditModules] = useState<EditableModule[]>([]);

  const enterEdit = () => {
    setEditTitle(pkg.title);
    setEditCategory(pkg.category);
    setEditModules(pkg.modules.map((m) => ({ ...m, _key: makeEditKey() })));
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
  };

  const handleSave = async () => {
    if (!editTitle.trim()) {
      toast({ title: "Package title is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // 1. Update package metadata
      await apiFetch(`/admin/ps-scripts/packages/${pkg.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ title: editTitle.trim(), category: editCategory }),
      });

      // 2. Delete modules that were removed
      const removedIds = pkg.modules
        .filter((orig) => orig.id && !editModules.some((em) => em.id === orig.id))
        .map((orig) => orig.id!);
      for (const mid of removedIds) {
        await apiFetch(`/admin/ps-scripts/modules/${mid}`, token, { method: "DELETE" });
      }

      // 3. Update existing modules / add new ones
      const savedModules: ScriptModuleItem[] = [];
      for (let i = 0; i < editModules.length; i++) {
        const em = editModules[i]!;
        if (em.id) {
          await apiFetch(`/admin/ps-scripts/modules/${em.id}`, token, {
            method: "PUT",
            body: JSON.stringify({
              filename: em.filename,
              description: em.description,
              content: em.content,
              sortOrder: i,
            }),
          });
          savedModules.push({ id: em.id, filename: em.filename, description: em.description, content: em.content });
        } else {
          const created = await apiFetch(`/admin/ps-scripts/packages/${pkg.id}/modules`, token, {
            method: "POST",
            body: JSON.stringify({
              filename: em.filename,
              description: em.description,
              content: em.content,
              sortOrder: i,
            }),
          }) as ScriptModuleItem;
          savedModules.push(created);
        }
      }

      // 4. Notify parent
      const updated: ScriptPackageListItem = {
        ...pkg,
        title: editTitle.trim(),
        category: editCategory,
        modules: savedModules,
      };
      onUpdated(updated);
      toast({ title: "Package saved" });
      setEditMode(false);
    } catch (err) {
      toast({ title: `Save failed: ${err instanceof Error ? err.message : "Unknown error"}`, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Module edit helpers ──────────────────────────────────────────────────
  const updateEditModule = (key: string, patch: Partial<EditableModule>) => {
    setEditModules((prev) => prev.map((m) => m._key === key ? { ...m, ...patch } : m));
  };

  const moveModule = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= editModules.length) return;
    setEditModules((prev) => {
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next]!, arr[idx]!];
      return arr;
    });
    setActiveModuleIdx(next);
  };

  const addModule = () => {
    const newMod: EditableModule = {
      _key: makeEditKey(),
      filename: `Module${editModules.length + 1}.ps1`,
      description: null,
      content: "",
    };
    setEditModules((prev) => [...prev, newMod]);
    setActiveModuleIdx(editModules.length);
  };

  const removeModule = (idx: number) => {
    if (editModules.length === 1) {
      toast({ title: "A package must have at least one module", variant: "destructive" });
      return;
    }
    setEditModules((prev) => prev.filter((_, i) => i !== idx));
    setActiveModuleIdx((prev) => Math.min(prev, editModules.length - 2));
  };

  // ── Delete package ───────────────────────────────────────────────────────
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

  // ── Read mode ────────────────────────────────────────────────────────────
  const activeModule = editMode ? editModules[activeModuleIdx] : pkg.modules[activeModuleIdx];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end bg-black/50 backdrop-blur-sm" onClick={editMode ? undefined : onClose}>
      <div className="bg-[#161B22] border border-[#30363D] h-full w-full sm:max-w-2xl flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D] flex-shrink-0 gap-3">
          {editMode ? (
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              <input
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-1.5 text-sm font-semibold text-[#E6EDF3] focus:outline-none focus:border-purple-500/60 placeholder-[#484F58]"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Package title"
              />
              <select
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-1.5 text-xs text-[#C9D1D9] focus:outline-none focus:border-purple-500/60"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <PackageBadge />
              <CategoryBadge category={pkg.category} />
            </div>
          )}
          <div className="flex items-center gap-2 flex-shrink-0">
            {editMode ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 hover:bg-purple-500/25 transition-colors disabled:opacity-50"
                >
                  {saving ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  )}
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={enterEdit}
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  Edit
                </button>
                <PackageDrawerPushButton packageId={pkg.id} token={token} moduleCount={pkg.modules.length} />
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
              </>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!editMode && (
            <div>
              <h2 className="text-lg font-bold text-[#E6EDF3]">{pkg.title}</h2>
              <p className="text-xs text-[#484F58] mt-1">{pkg.modules.length} modules · Saved {formatDate(pkg.createdAt)}</p>
            </div>
          )}

          {/* Module tabs */}
          {(editMode ? editModules.length > 0 : pkg.modules.length > 0) && (
            <div className="bg-[#1C2128] border border-[#30363D] rounded-xl overflow-hidden">
              {/* Tab list */}
              <div className="flex flex-wrap gap-1 p-1 border-b border-[#30363D]">
                {(editMode ? editModules : pkg.modules).map((m, i) => (
                  <button
                    key={editMode ? (m as EditableModule)._key : i}
                    onClick={() => setActiveModuleIdx(i)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all truncate max-w-[160px] ${activeModuleIdx === i ? "bg-purple-500/15 text-purple-400 border border-purple-500/25" : "text-[#7D8590] hover:text-[#E6EDF3] border border-transparent"}`}
                    title={m.filename}
                  >
                    {m.filename}
                  </button>
                ))}
                {editMode && (
                  <button
                    onClick={addModule}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-[#30363D] text-[#484F58] hover:text-[#7D8590] hover:border-[#484F58] transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                    Add module
                  </button>
                )}
              </div>

              {/* Active module view / edit */}
              {activeModule && (
                <div>
                  {editMode ? (
                    <div className="flex flex-col gap-0">
                      {/* Filename + reorder/delete controls */}
                      <div className="flex items-center gap-2 px-3 py-2 bg-[#161B22] border-b border-[#30363D]">
                        <input
                          className="flex-1 bg-[#0D1117] border border-[#30363D] rounded px-2.5 py-1 text-xs font-mono text-[#C9D1D9] focus:outline-none focus:border-purple-500/60"
                          value={activeModule.filename}
                          onChange={(e) => updateEditModule((activeModule as EditableModule)._key, { filename: e.target.value })}
                          placeholder="module-name.ps1"
                        />
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => moveModule(activeModuleIdx, -1)}
                            disabled={activeModuleIdx === 0}
                            title="Move up"
                            className="p-1 rounded text-[#484F58] hover:text-[#8B949E] hover:bg-[#21262D] disabled:opacity-25 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                          </button>
                          <button
                            onClick={() => moveModule(activeModuleIdx, 1)}
                            disabled={activeModuleIdx === editModules.length - 1}
                            title="Move down"
                            className="p-1 rounded text-[#484F58] hover:text-[#8B949E] hover:bg-[#21262D] disabled:opacity-25 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                          </button>
                          <button
                            onClick={() => removeModule(activeModuleIdx)}
                            title="Delete module"
                            className="p-1 rounded text-[#484F58] hover:text-red-400 hover:bg-red-400/10 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                      {/* Content editor */}
                      <div className="min-h-[300px] max-h-[520px] overflow-auto">
                        <CodeMirror
                          value={activeModule.content}
                          height="100%"
                          minHeight="300px"
                          theme={oneDark}
                          extensions={[StreamLanguage.define(powerShell), ...powershellExtensions]}
                          onChange={(val) => updateEditModule((activeModule as EditableModule)._key, { content: val })}
                          basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: true }}
                          style={{ fontSize: "12px" }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between px-4 py-2.5 bg-[#161B22]">
                        <span className="text-xs font-mono text-[#7D8590]">{activeModule.filename}</span>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => copyToClipboard(activeModule.content)} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">Copy</button>
                          <button onClick={() => downloadFile(activeModule.content, activeModule.filename)} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">Download</button>
                        </div>
                      </div>
                      <pre className="bg-[#0D1117] text-[#C9D1D9] font-mono text-xs leading-relaxed p-4 overflow-x-auto whitespace-pre" style={{ fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace" }}>{activeModule.content}</pre>
                    </div>
                  )}
                </div>
              )}
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
  packageId,
  token,
  onBack,
  onDeleted,
}: {
  modules: ScriptModuleItem[];
  packageTitle: string;
  packageId: string | null;
  token: string;
  onBack: () => void;
  onDeleted?: (id: string) => void;
}) {
  const { toast } = useToast();
  const [activeIdx, setActiveIdx] = useState(0);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [pushing, setPushing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pushStatuses, setPushStatuses] = useState<Record<string, "idle" | "pushing" | "done" | "error">>({});
  const activeModule = modules[activeIdx];

  const handleCopy = (idx: number) => {
    copyToClipboard(modules[idx]!.content);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleDelete = async () => {
    if (!packageId) return;
    if (!confirm(`Delete package "${packageTitle}" and all its modules? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/admin/ps-scripts/packages/${packageId}`, token, { method: "DELETE" });
      toast({ title: "Package deleted" });
      onDeleted?.(packageId);
      onBack();
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
      setDeleting(false);
    }
  };

  const handlePushToAzure = async () => {
    if (!packageId) return;
    setPushing(true);
    setPushStatuses(Object.fromEntries(modules.map((m) => [m.filename, "pushing" as const])));
    try {
      type PushApiResult = {
        ok: boolean;
        warning?: string;
        results?: { filename: string; runbookName: string; ok: boolean; error?: string }[];
      };
      const data = (await apiFetch(
        `/admin/ps-scripts/packages/${packageId}/push-to-azure`,
        token,
        { method: "POST" },
      )) as PushApiResult;

      if (data.warning) {
        toast({ title: "Azure push skipped", description: data.warning });
        setPushStatuses(Object.fromEntries(modules.map((m) => [m.filename, "idle" as const])));
        return;
      }

      const next: Record<string, "idle" | "pushing" | "done" | "error"> = {};
      for (const r of data.results ?? []) next[r.filename] = r.ok ? "done" : "error";
      setPushStatuses(next);

      const failed = (data.results ?? []).filter((r) => !r.ok);
      if (failed.length === 0) {
        toast({ title: "All modules pushed to Azure", description: `${modules.length} runbook(s) created/updated` });
      } else {
        toast({
          title: `${failed.length} module(s) failed`,
          description: failed.map((f) => `${f.filename}: ${f.error ?? "unknown"}`).join(" | "),
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({ title: "Push failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
      setPushStatuses(Object.fromEntries(modules.map((m) => [m.filename, "idle" as const])));
    } finally {
      setPushing(false);
    }
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
          {packageId && (
            <button
              onClick={handlePushToAzure}
              disabled={pushing}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#0078D4]/15 border border-[#0078D4]/35 text-[#58A6FF] hover:bg-[#0078D4]/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Push each module as its own Azure Automation runbook"
            >
              {pushing ? (
                <><div className="w-3.5 h-3.5 border-2 border-[#58A6FF]/40 border-t-[#58A6FF] rounded-full animate-spin" />Pushing…</>
              ) : (
                <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>Push to Azure</>
              )}
            </button>
          )}
          <button onClick={() => downloadAllModulesAsZip(modules, packageTitle)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 hover:bg-purple-500/25 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Download All (.zip)
          </button>
          {packageId && (
            <button
              onClick={handleDelete}
              disabled={deleting || pushing}
              className="p-1.5 text-[#7D8590] hover:text-red-400 hover:bg-red-400/10 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Delete this package"
            >
              {deleting
                ? <div className="w-4 h-4 border-2 border-red-400/40 border-t-red-400 rounded-full animate-spin" />
                : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              }
            </button>
          )}
          <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Back to editor
          </button>
        </div>
      </div>
      {/* Per-module push status bar — shown while pushing or after */}
      {Object.values(pushStatuses).some((s) => s !== "idle") && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 bg-[#0D1117] border-b border-[#21262D] flex-shrink-0">
          {modules.map((m) => {
            const s = pushStatuses[m.filename] ?? "idle";
            return (
              <span key={m.filename} className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border ${s === "done" ? "border-[#3FB950]/40 bg-[#3FB950]/10 text-[#3FB950]" : s === "error" ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-[#30363D] text-[#7D8590]"}`}>
                {s === "pushing" && <div className="w-2.5 h-2.5 border border-[#58A6FF]/40 border-t-[#58A6FF] rounded-full animate-spin" />}
                {s === "done" && <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                {s === "error" && <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>}
                {m.filename.replace(/\.ps1$/i, "")}
              </span>
            );
          })}
        </div>
      )}
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
  onOpenScript,
  onOpenPackage,
  loadingScriptId,
}: {
  scripts: PsScriptListItem[];
  packages: ScriptPackageListItem[];
  loading: boolean;
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

  return (
    <div className="flex flex-col bg-[#0D1117] overflow-hidden" style={{ width: "100%", height: "100%" }}>
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

// ─── Inline Script Runner (right panel) ──────────────────────────────────────

interface InlineClientEntry {
  id: number;
  name: string;
  credential: { id: number; displayName: string | null } | null;
}

interface InlineRunbookEntry {
  name: string;
  state?: string;
}

interface InlineAIAnalysis {
  summary: string;
  risks: string[];
  recommendations: string[];
  nextSteps: string[];
}

const INLINE_JOB_COLORS: Record<string, string> = {
  "Running":   "text-yellow-400",
  "Completed": "text-green-400",
  "Failed":    "text-red-400",
  "Stopped":   "text-[#7D8590]",
  "Suspended": "text-orange-400",
};

const ADHOC_SENTINEL = "__adhoc__";
const ADHOC_RUNBOOK_NAME = "IDE-AdHoc";

function InlineScriptRunner({
  scriptBody,
  editorScript,
  presetRunbook,
  onPresetConsumed,
  governanceAreas,
}: {
  scriptBody: string;
  editorScript: PsScriptDetail | null;
  presetRunbook?: string | null;
  onPresetConsumed?: () => void;
  governanceAreas?: string[];
}) {
  const { fetchWithAuth } = useAuth();

  const [clients, setClients]           = useState<InlineClientEntry[]>([]);
  const [runbooks, setRunbooks]         = useState<InlineRunbookEntry[]>([]);
  const [loadingClients, setLoadingClients]   = useState(true);
  const [loadingRunbooks, setLoadingRunbooks] = useState(false);
  const [azureConfigured, setAzureConfigured] = useState<boolean | null>(null);

  const [selectedClientId, setSelectedClientId] = useState<number | "">("");
  const [selectedCredId,   setSelectedCredId]   = useState<number | "">("");
  const [selectedRunbook,  setSelectedRunbook]  = useState("");

  const [running,   setRunning]   = useState(false);
  const [jobStatus, setJobStatus] = useState("Never run");
  const [logLines,  setLogLines]  = useState<string[]>([]);
  const logEndRef   = useRef<HTMLDivElement>(null);
  const abortedRef  = useRef(false);

  const [aiAnalysis,   setAiAnalysis]   = useState<InlineAIAnalysis | null>(null);
  const [analyzingAI,  setAnalyzingAI]  = useState(false);
  const [aiError,      setAiError]      = useState<string | null>(null);
  const [aiTab,        setAiTab]        = useState<keyof InlineAIAnalysis>("summary");

  // Mark component as unmounted so polling stops cleanly
  useEffect(() => () => { abortedRef.current = true; }, []);

  // Auto-scroll log
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logLines]);

  // Check Azure config + load clients on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/runbooks");
        const data = await res.json() as { configured: boolean };
        setAzureConfigured(res.status === 503 && data.configured === false ? false : true);
      } catch { /* unknown — leave null */ }
    })();
    void (async () => {
      setLoadingClients(true);
      try {
        const res = await fetchWithAuth("/api/admin/clients/with-azure-credentials");
        if (res.ok) {
          const data = await res.json() as Array<{ id: number; name: string; email: string; credential: { id: number; displayName: string | null } | null }>;
          setClients(data.map(c => ({ id: c.id, name: c.name, credential: c.credential })));
        }
      } finally { setLoadingClients(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load runbooks when a credential is selected
  useEffect(() => {
    if (!selectedCredId) { setRunbooks([]); setSelectedRunbook(""); return; }
    void (async () => {
      setLoadingRunbooks(true);
      try {
        const res = await fetchWithAuth("/api/admin/runbooks");
        const data = await res.json() as { configured: boolean; runbooks?: InlineRunbookEntry[] };
        if (res.ok && data.configured) {
          setAzureConfigured(true);
          const list = data.runbooks ?? [];
          setRunbooks(list);
          // Pre-select: catalog preset takes priority, then the editor script's runbook.
          // (auto-select ADHOC_SENTINEL when no preset is active is handled in the separate effect below)
          if (presetRunbook && list.some(r => r.name === presetRunbook)) {
            setSelectedRunbook(presetRunbook);
            onPresetConsumed?.();
          } else if (editorScript?.azureRunbookName) {
            setSelectedRunbook(editorScript.azureRunbookName);
          }
        } else if (res.status === 503) {
          setAzureConfigured(false);
        }
      } catch { /* ignore */ }
      finally { setLoadingRunbooks(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCredId, presetRunbook]);

  // Auto-select ADHOC_SENTINEL when runbooks finish loading if editor has content
  // and no runbook is pre-selected (mirrors m365-scripts behaviour)
  useEffect(() => {
    if (!loadingRunbooks && runbooks.length >= 0 && selectedRunbook === "" && scriptBody.trim().length > 0) {
      setSelectedRunbook(ADHOC_SENTINEL);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingRunbooks]);

  const handleRun = async () => {
    if (!selectedCredId || !selectedRunbook) return;
    const isAdHoc = selectedRunbook === ADHOC_SENTINEL;
    if (isAdHoc && !scriptBody.trim()) return;
    const actualRunbook = isAdHoc
      ? (editorScript?.azureRunbookName ?? ADHOC_RUNBOOK_NAME)
      : selectedRunbook;

    setRunning(true);
    setLogLines(isAdHoc ? ["[Uploading current script to Azure…]"] : ["[Starting job…]"]);
    setJobStatus("New");
    setAiAnalysis(null);
    setAiError(null);

    try {
      const areasPayload = Array.isArray(governanceAreas) && governanceAreas.length > 0 ? governanceAreas : undefined;
      const body: Record<string, unknown> = {
        credentialId: selectedCredId,
        runbookName: actualRunbook,
        ...(areasPayload ? { governanceAreas: areasPayload } : {}),
      };
      if (isAdHoc) body["adHocContent"] = scriptBody;
      const res = await fetchWithAuth("/api/admin/runbook-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setLogLines(prev => [...prev, `[Error: ${err.error ?? "Failed to start job"}]`]);
        setRunning(false);
        return;
      }
      const { jobId } = await res.json() as { jobId: string };
      let lastSeq = -1;

      const poll = async (): Promise<void> => {
        if (abortedRef.current) return;
        try {
          const pollRes = await fetchWithAuth(`/api/admin/runbook-jobs/output?jobId=${encodeURIComponent(jobId)}&since=${lastSeq}`);
          if (!pollRes.ok) throw new Error("poll failed");
          const data = await pollRes.json() as { status: string; terminal: boolean; lines: Array<{ sequence: number; text: string }> };
          if (abortedRef.current) return;
          setJobStatus(data.status);
          if (data.lines.length > 0) {
            setLogLines(prev => [...prev, ...data.lines.map(l => l.text)]);
            lastSeq = Math.max(...data.lines.map(l => l.sequence));
          }
          if (data.terminal) {
            setLogLines(prev => [...prev, `[Job ${data.status}]`]);
            setRunning(false);
            // Signal the m365-scripts page to refresh its job history
            window.dispatchEvent(new CustomEvent("runbook-job-complete"));
            return;
          }
          setTimeout(() => void poll(), 3000);
        } catch {
          if (!abortedRef.current) {
            setLogLines(prev => [...prev, "[Polling error — job may still be running in Azure]"]);
            setRunning(false);
          }
        }
      };
      void poll();
    } catch {
      setLogLines(prev => [...prev, "[Network error]"]);
      setRunning(false);
    }
  };

  const handleAnalyze = async () => {
    if (!logLines.length || running) return;
    setAnalyzingAI(true);
    setAiAnalysis(null);
    setAiError(null);
    setAiTab("summary");
    const clientName = clients.find(c => c.id === selectedClientId)?.name;
    try {
      const res = await fetchWithAuth("/api/admin/scripts/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output: logLines.join("\n"), runbookName: selectedRunbook || undefined, customerName: clientName }),
      });
      const data = await res.json() as InlineAIAnalysis & { error?: string };
      if (!res.ok) { setAiError(data.error ?? "AI analysis failed"); return; }
      setAiAnalysis(data);
    } catch {
      setAiError("Request failed — check connection");
    } finally {
      setAnalyzingAI(false);
    }
  };

  const isTerminal = ["Completed", "Failed", "Stopped", "Suspended"].includes(jobStatus);
  const isAdHocSelected = selectedRunbook === ADHOC_SENTINEL;
  const canRun = !!selectedCredId && selectedRunbook !== "" && !running && !(isAdHocSelected && !scriptBody.trim());
  const statusColor = INLINE_JOB_COLORS[jobStatus] ?? "text-[#7D8590]";
  const currentRunbookName = editorScript?.azureRunbookName ?? null;
  const hasEditorContent = scriptBody.trim().length > 0;
  const selectedClient = clients.find(c => c.id === selectedClientId);

  if (azureConfigured === false) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 text-center gap-2">
        <svg className="w-8 h-8 text-amber-500/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
        <p className="text-[11px] text-amber-400 font-semibold">Azure not configured</p>
        <p className="text-[10px] text-[#7D8590] leading-relaxed">Add Azure secrets in Replit Secrets to enable script execution</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Config section */}
      <div className="flex-shrink-0 p-3 space-y-2 border-b border-[#21262D]">
        {/* Customer */}
        <div>
          <label className="block text-[9px] font-bold uppercase tracking-wider text-[#484F58] mb-1">Customer</label>
          {loadingClients ? (
            <div className="h-7 bg-[#161B22] rounded animate-pulse" />
          ) : (
            <select
              value={selectedClientId}
              onChange={e => {
                const clientId = e.target.value ? Number(e.target.value) : "";
                setSelectedClientId(clientId);
                const cred = clientId ? clients.find(c => c.id === clientId)?.credential : null;
                setSelectedCredId(cred?.id ?? "");
                setSelectedRunbook("");
              }}
              className="w-full bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/50 transition-colors"
            >
              <option value="">Select customer…</option>
              {clients.map(c => (
                <option key={c.id} value={c.id} disabled={!c.credential}>
                  {c.name}{!c.credential ? " (no credential)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Credential — shown after client selected, explicit picker matching m365-scripts */}
        {selectedClientId !== "" && selectedClient && (
          <div>
            <label className="block text-[9px] font-bold uppercase tracking-wider text-[#484F58] mb-1">Credential</label>
            {selectedClient.credential ? (
              <select
                value={selectedCredId}
                onChange={e => { setSelectedCredId(e.target.value ? Number(e.target.value) : ""); setSelectedRunbook(""); }}
                className="w-full bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/50 transition-colors"
              >
                <option value="">Select credential…</option>
                <option value={selectedClient.credential.id}>
                  {selectedClient.credential.displayName ?? `Credential #${selectedClient.credential.id}`}
                </option>
              </select>
            ) : (
              <p className="text-[10px] text-amber-400">No Azure credential — add one in the CRM first.</p>
            )}
          </div>
        )}

        {/* Runbook — only after credential selected */}
        {selectedCredId !== "" && (
          <div>
            <label className="block text-[9px] font-bold uppercase tracking-wider text-[#484F58] mb-1">Runbook</label>
            {loadingRunbooks ? (
              <div className="h-7 bg-[#161B22] rounded animate-pulse" />
            ) : (
              <select
                value={selectedRunbook}
                onChange={e => setSelectedRunbook(e.target.value)}
                className="w-full bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/50 transition-colors"
              >
                <option value="">Select runbook…</option>
                {hasEditorContent && (
                  <option value={ADHOC_SENTINEL}>
                    ▶ Run current script{currentRunbookName ? ` → ${currentRunbookName}` : ` → ${ADHOC_RUNBOOK_NAME}`}
                  </option>
                )}
                {currentRunbookName && (
                  <option value={currentRunbookName}>★ {currentRunbookName} (saved runbook)</option>
                )}
                {runbooks
                  .filter(r => r.name !== currentRunbookName)
                  .map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
              </select>
            )}
          </div>
        )}

        {/* Run button + status badge */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleRun()}
            disabled={!canRun}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {running ? (
              <><div className="w-3 h-3 border border-green-400/40 border-t-green-400 rounded-full animate-spin" />Running…</>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /></svg>
                Run
              </>
            )}
          </button>
          {jobStatus !== "Never run" && (
            <span className={`text-[10px] font-semibold ${statusColor}`}>{jobStatus}</span>
          )}
        </div>
      </div>

      {/* Log console */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 font-mono text-[10px] leading-relaxed bg-[#0A0E14]">
        {logLines.length === 0 ? (
          <span className="text-[#30363D]">Output will appear here after running…</span>
        ) : (
          logLines.map((line, i) => (
            <div
              key={i}
              className={
                line.startsWith("[Error") || line.includes("[Job Failed") ? "text-red-400" :
                line.includes("[Job Completed") ? "text-green-400" :
                line.startsWith("[") ? "text-[#7D8590]" :
                "text-[#C9D1D9]"
              }
            >
              {line}
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

      {/* AI Analyze section — shown after terminal job */}
      {isTerminal && logLines.length > 1 && (
        <div className="flex-shrink-0 border-t border-[#21262D] p-3 space-y-2">
          {!aiAnalysis && !analyzingAI && !aiError && (
            <button
              onClick={() => void handleAnalyze()}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#0078D4]/15 border border-[#0078D4]/30 text-[#58A6FF] hover:bg-[#0078D4]/25 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
              Analyze with AI
            </button>
          )}
          {analyzingAI && (
            <div className="flex items-center justify-center gap-2 py-1">
              <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              <span className="text-[11px] text-[#7D8590]">Analyzing…</span>
            </div>
          )}
          {aiError && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-red-400">{aiError}</p>
              <button onClick={() => void handleAnalyze()} className="text-[10px] text-[#58A6FF] underline">Retry</button>
            </div>
          )}
          {aiAnalysis && (
            <div className="space-y-2">
              <div className="flex gap-1 flex-wrap">
                {(["summary", "risks", "recommendations", "nextSteps"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setAiTab(t)}
                    className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${aiTab === t ? "bg-[#0078D4]/15 text-[#58A6FF] border border-[#0078D4]/25" : "text-[#7D8590] hover:text-[#E6EDF3] border border-transparent"}`}
                  >
                    {t === "nextSteps" ? "Next Steps" : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-[#C9D1D9] leading-relaxed max-h-40 overflow-y-auto">
                {aiTab === "summary" ? (
                  <p>{aiAnalysis.summary}</p>
                ) : (
                  <ul className="space-y-1">
                    {(aiAnalysis[aiTab] as string[]).map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="mt-1.5 w-1 h-1 rounded-full bg-[#0078D4] flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button onClick={() => { setAiAnalysis(null); setAiError(null); }} className="text-[10px] text-[#484F58] hover:text-[#7D8590] transition-colors">Clear</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Right panel wrapper (Runner + Permissions tabs) ──────────────────────────

function RightPanel({
  permissions,
  scriptLoaded,
  scriptBody,
  editorScript,
  activeTab,
  onActiveTabChange,
  presetRunbook,
  onPresetConsumed,
}: {
  permissions: PsScriptPermissions;
  scriptLoaded: boolean;
  scriptBody: string;
  editorScript: PsScriptDetail | null;
  activeTab: "runner" | "permissions";
  onActiveTabChange: (t: "runner" | "permissions") => void;
  presetRunbook: string | null;
  onPresetConsumed: () => void;
}) {
  const switchTab = (t: string) => {
    const tab = t as "runner" | "permissions";
    onActiveTabChange(tab);
    lsSet(IDE_RIGHT_TAB_KEY, tab);
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={switchTab}
      className="flex flex-col h-full border-l border-[#21262D] bg-[#0D1117] overflow-hidden"
    >
      {/* Content fills the top — each TabsContent is flex-1 so it expands */}
      <TabsContent
        value="runner"
        className="flex-1 min-h-0 overflow-hidden flex flex-col mt-0 p-0"
      >
        <InlineScriptRunner scriptBody={scriptBody} editorScript={editorScript} presetRunbook={presetRunbook} onPresetConsumed={onPresetConsumed} />
      </TabsContent>
      <TabsContent
        value="permissions"
        className="flex-1 min-h-0 overflow-hidden flex flex-col mt-0 p-0"
      >
        <PermissionsSidebarPanel permissions={scriptLoaded ? permissions : null} />
      </TabsContent>

      {/* Tab strip pinned at the bottom */}
      <TabsList className="flex-shrink-0 h-9 w-full rounded-none border-t border-[#21262D] bg-[#161B22] p-0 gap-0 justify-start">
        <TabsTrigger
          value="runner"
          className="h-full px-4 rounded-none text-[10px] font-bold uppercase tracking-wider border-0 shadow-none data-[state=active]:bg-[#0078D4]/15 data-[state=active]:text-[#58A6FF] data-[state=active]:shadow-none data-[state=inactive]:text-[#484F58]"
        >
          Runner
        </TabsTrigger>
        <TabsTrigger
          value="permissions"
          className="h-full px-4 rounded-none text-[10px] font-bold uppercase tracking-wider border-0 shadow-none data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-400 data-[state=active]:shadow-none data-[state=inactive]:text-[#484F58]"
        >
          Permissions
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

// ─── Right Permissions Sidebar ────────────────────────────────────────────────

function PermissionsSidebarPanel({ permissions }: { permissions: PsScriptPermissions | null }) {
  const totalCount = permissions
    ? permissions.appPermissions.length + permissions.delegatedPermissions.length
    : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0D1117]">
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

// ─── Generating Progress Dialog ───────────────────────────────────────────────

const GEN_PHASES: { label: string; desc: string; target: number }[] = [
  { label: "Analyzing prompt",      desc: "Parsing the task and identifying the M365/Azure service scope",                target: 12 },
  { label: "Planning structure",    desc: "Designing parameter blocks, error handling flow, and cmdlet sequence",          target: 35 },
  { label: "Writing PowerShell",    desc: "Generating production-ready code with try/catch logging and CSV export",        target: 68 },
  { label: "Detecting permissions", desc: "Scanning for required Graph API application and delegated role scopes",         target: 84 },
  { label: "Finalizing output",     desc: "Validating script structure and formatting the final response",                 target: 96 },
];

function GeneratingProgressDialog({ open }: { open: boolean }) {
  const [pct, setPct] = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const phaseRef = useRef(0);
  const pctRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setPct(0);
      setPhaseIdx(0);
      phaseRef.current = 0;
      pctRef.current = 0;
      return;
    }
    const id = setInterval(() => {
      const phase = phaseRef.current;
      const target = GEN_PHASES[phase]?.target ?? 96;
      const cur = pctRef.current;
      if (cur < target) {
        const step = Math.max(0.2, (target - cur) * 0.04);
        const next = Math.min(cur + step, target);
        pctRef.current = next;
        setPct(next);
      } else if (phase < GEN_PHASES.length - 1) {
        phaseRef.current = phase + 1;
        setPhaseIdx(phase + 1);
      }
    }, 60);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  const phase = GEN_PHASES[Math.min(phaseIdx, GEN_PHASES.length - 1)];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
      <div className="w-full max-w-sm mx-4 bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-[#0078D4]/15 border border-[#0078D4]/30 flex items-center justify-center flex-shrink-0">
            <div className="w-4 h-4 border-2 border-[#0078D4]/30 border-t-[#0078D4] rounded-full animate-spin" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#E6EDF3]">Generating Script</h2>
            <p className="text-[10px] text-[#7D8590]">Claude is writing your PowerShell automation</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-[#E6EDF3]">{phase.label}</span>
            <span className="text-[10px] text-[#7D8590] tabular-nums">{Math.round(pct)}%</span>
          </div>
          <div className="h-1.5 bg-[#21262D] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-75"
              style={{ width: `${pct}%`, background: "linear-gradient(90deg, #0078D4, #00B4D8)" }}
            />
          </div>
          <p className="text-[11px] text-[#7D8590] mt-1.5 leading-relaxed">{phase.desc}</p>
        </div>

        {/* Phase checklist */}
        <div className="space-y-0.5">
          {GEN_PHASES.map((p, i) => {
            const done = i < phaseIdx;
            const active = i === phaseIdx;
            return (
              <div
                key={p.label}
                className={`flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg transition-colors ${active ? "bg-[#0078D4]/10" : ""}`}
              >
                {done ? (
                  <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : active ? (
                  <div className="w-3.5 h-3.5 border border-[#0078D4]/40 border-t-[#0078D4] rounded-full animate-spin flex-shrink-0" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-[#21262D] flex-shrink-0" />
                )}
                <span className={`text-[11px] ${done ? "text-[#484F58] line-through" : active ? "text-[#E6EDF3] font-medium" : "text-[#484F58]"}`}>
                  {p.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Generate from Service Dialog ────────────────────────────────────────────

function GenerateFromServiceDialog({
  token,
  baseInstructions,
  detailedInstructions,
  onClose,
  onScriptGenerated,
  onPackageGenerated,
}: {
  token: string;
  baseInstructions: string;
  detailedInstructions: string;
  onClose: () => void;
  onScriptGenerated: (title: string, script: string, permissions: PsScriptPermissions) => void;
  onPackageGenerated: (packageId: string, title: string, modules: ScriptModuleItem[], permissions: PsScriptPermissions) => void;
}) {
  const { toast } = useToast();
  const [services, setServices] = useState<ServiceListItem[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);
  const [workflowTemplate, setWorkflowTemplate] = useState<WorkflowTemplateDetail | null>(null);
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [serviceSearch, setServiceSearch] = useState("");
  const [customInstructions, setCustomInstructions] = useState(
    () => localStorage.getItem("gfs-custom-instructions") ?? "",
  );
  const [generating, setGenerating] = useState(false);
  const [humanOnlyTasks, setHumanOnlyTasks] = useState<string[]>([]);
  const [humanOnlyExplanation, setHumanOnlyExplanation] = useState<string | null>(null);

  type PackageResult = {
    packageId: string;
    title: string;
    modules: ScriptModuleItem[];
    permissions: PsScriptPermissions;
  };
  type PushModuleStatus = "idle" | "pushing" | "done" | "error";
  const [packageResult, setPackageResult] = useState<PackageResult | null>(null);
  const [pushStatuses, setPushStatuses] = useState<Record<string, PushModuleStatus>>({});
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    apiFetch("/admin/services", token)
      .then((data) => setServices(data as ServiceListItem[]))
      .catch(() => toast({ title: "Failed to load services", variant: "destructive" }))
      .finally(() => setLoadingServices(false));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedService = services.find((s) => s.id === selectedServiceId) ?? null;

  useEffect(() => {
    if (!selectedService?.workflowTemplateId) {
      setWorkflowTemplate(null);
      return;
    }
    setLoadingWorkflow(true);
    apiFetch(`/admin/workflow-templates/${selectedService.workflowTemplateId}`, token)
      .then((data) => setWorkflowTemplate(data as WorkflowTemplateDetail))
      .catch(() => toast({ title: "Failed to load workflow template", variant: "destructive" }))
      .finally(() => setLoadingWorkflow(false));
  }, [selectedService?.workflowTemplateId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasContext =
    selectedService &&
    (selectedService.workflowTemplateId ||
      (selectedService.deliverables?.length ?? 0) > 0 ||
      (selectedService.inclusions?.length ?? 0) > 0 ||
      (selectedService.features?.length ?? 0) > 0);

  const handlePushPackageToAzure = async () => {
    if (!packageResult) return;
    setPushing(true);
    // Mark all as pushing
    setPushStatuses(Object.fromEntries(packageResult.modules.map((m) => [m.filename, "pushing" as PushModuleStatus])));
    try {
      type PushApiResult = {
        ok: boolean;
        warning?: string;
        results?: { filename: string; runbookName: string; ok: boolean; error?: string }[];
      };
      const data = (await apiFetch(
        `/admin/ps-scripts/packages/${packageResult.packageId}/push-to-azure`,
        token,
        { method: "POST" },
      )) as PushApiResult;

      if (data.warning) {
        toast({ title: "Azure push skipped", description: data.warning });
        setPushStatuses(Object.fromEntries(packageResult.modules.map((m) => [m.filename, "idle" as PushModuleStatus])));
        return;
      }

      const nextStatuses: Record<string, PushModuleStatus> = {};
      for (const r of data.results ?? []) {
        nextStatuses[r.filename] = r.ok ? "done" : "error";
      }
      setPushStatuses(nextStatuses);

      const failed = (data.results ?? []).filter((r) => !r.ok);
      if (failed.length === 0) {
        toast({ title: "All modules pushed to Azure", description: `${packageResult.modules.length} runbook(s) created/updated` });
      } else {
        toast({
          title: `${failed.length} module(s) failed to push`,
          description: failed.map((f) => `${f.filename}: ${f.error ?? "unknown error"}`).join(" | "),
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({ title: "Push failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
      setPushStatuses(Object.fromEntries(packageResult.modules.map((m) => [m.filename, "idle" as PushModuleStatus])));
    } finally {
      setPushing(false);
    }
  };

  const handleDonePackage = () => {
    if (!packageResult) return;
    onPackageGenerated(packageResult.packageId, packageResult.title, packageResult.modules, packageResult.permissions);
    onClose();
  };

  const handleGenerate = async () => {
    if (!selectedServiceId) return;
    setGenerating(true);
    setHumanOnlyExplanation(null);
    try {
      type GenResult = {
        type: "single" | "package" | "human-only";
        title: string;
        explanation?: string;
        script?: string;
        packageId?: string;
        modules?: ScriptModuleItem[];
        humanOnlyTasks: string[];
        permissions: PsScriptPermissions;
      };
      const result = (await apiFetch("/admin/ps-scripts/generate-from-service", token, {
        method: "POST",
        body: JSON.stringify({
          serviceId: selectedServiceId,
          customInstructions: customInstructions.trim() || undefined,
          baseInstructions: baseInstructions.trim() || undefined,
          detailedInstructions: detailedInstructions.trim() || undefined,
        }),
      })) as GenResult;

      if (result.humanOnlyTasks?.length > 0) {
        setHumanOnlyTasks(result.humanOnlyTasks);
      }

      if (result.type === "human-only") {
        setHumanOnlyExplanation(result.explanation ?? "All tasks in this workflow require human action.");
        toast({ title: result.title ?? "No automation possible", description: "See details below." });
      } else if (result.type === "package" && result.packageId && result.modules) {
        const pkgPerms: PsScriptPermissions = result.permissions ?? { appPermissions: [], delegatedPermissions: [], notes: "" };
        setPackageResult({ packageId: result.packageId, title: result.title, modules: result.modules, permissions: pkgPerms });
        setPushStatuses(Object.fromEntries(result.modules.map((m) => [m.filename, "idle" as PushModuleStatus])));
      } else if (result.type === "single" && result.script) {
        onScriptGenerated(result.title, result.script, result.permissions);
        onClose();
      } else {
        toast({ title: "Generation returned unexpected format", variant: "destructive" });
      }
    } catch (e) {
      toast({
        title: "Generation failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-2xl mx-4 bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#21262D] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-teal-500/15 border border-teal-500/30 flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#E6EDF3]">Generate from Service</h2>
              <p className="text-[10px] text-[#7D8590]">AI classifies workflow tasks and generates PowerShell automation for M365/Azure steps</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-[#484F58] hover:text-[#E6EDF3] rounded transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {/* Service picker */}
          <div>
            <label className="block text-[10px] font-medium text-[#7D8590] mb-1.5 uppercase tracking-wide">Select Service</label>
            {loadingServices ? (
              <div className="flex items-center gap-2 text-xs text-[#7D8590] py-2">
                <div className="w-3.5 h-3.5 border border-[#484F58] border-t-[#8B949E] rounded-full animate-spin" />
                Loading services…
              </div>
            ) : services.length === 0 ? (
              <p className="text-xs text-[#7D8590]">No services found. Create services in the Service Management page first.</p>
            ) : (
              <div className="space-y-1.5">
                {/* Search input */}
                <input
                  type="text"
                  placeholder="Search services…"
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors"
                />
                {/* Scrollable list */}
                <div className="max-h-44 overflow-y-auto border border-[#21262D] rounded-lg divide-y divide-[#21262D]">
                  {services
                    .filter((s) => {
                      const q = serviceSearch.toLowerCase();
                      return (
                        !q ||
                        s.name.toLowerCase().includes(q) ||
                        (s.category ?? "").toLowerCase().includes(q) ||
                        (s.tier ?? "").toLowerCase().includes(q)
                      );
                    })
                    .map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSelectedServiceId(s.id === selectedServiceId ? null : s.id);
                          setHumanOnlyTasks([]);
                          setHumanOnlyExplanation(null);
                        }}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                          selectedServiceId === s.id
                            ? "bg-[#0078D4]/15 border-l-2 border-[#0078D4]"
                            : "bg-[#0D1117] hover:bg-[#161B22] border-l-2 border-transparent"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-xs text-[#E6EDF3] truncate font-medium">{s.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {s.category && (
                              <span className="text-[10px] text-[#58A6FF] bg-[#1F6FEB]/15 border border-[#1F6FEB]/30 rounded px-1.5 py-0.5">{s.category}</span>
                            )}
                            {s.tier && (
                              <span className="text-[10px] text-[#3FB950] bg-[#238636]/15 border border-[#238636]/30 rounded px-1.5 py-0.5">{s.tier}</span>
                            )}
                            {!s.workflowTemplateId && (
                              <span className="text-[10px] text-[#7D8590]">no workflow</span>
                            )}
                          </div>
                        </div>
                        {selectedServiceId === s.id && (
                          <svg className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        )}
                      </button>
                    ))}
                  {services.filter((s) => {
                    const q = serviceSearch.toLowerCase();
                    return !q || s.name.toLowerCase().includes(q) || (s.category ?? "").toLowerCase().includes(q) || (s.tier ?? "").toLowerCase().includes(q);
                  }).length === 0 && (
                    <p className="text-xs text-[#7D8590] px-3 py-2">No services match "{serviceSearch}"</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Selected service context */}
          {selectedService && (
            <div className="space-y-3">
              {selectedService.description && (
                <p className="text-[11px] text-[#8B949E] leading-relaxed bg-[#0D1117] border border-[#21262D] rounded-lg px-3 py-2.5">
                  {selectedService.description}
                </p>
              )}

              {!selectedService.workflowTemplateId && (
                <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5">
                  <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                  <p className="text-[11px] text-amber-300/80">No workflow template linked. Generation will use service description and deliverables only. For richer results, link a workflow template in Service Management.</p>
                </div>
              )}

              {loadingWorkflow && (
                <div className="flex items-center gap-2 text-xs text-[#7D8590]">
                  <div className="w-3.5 h-3.5 border border-[#484F58] border-t-[#8B949E] rounded-full animate-spin" />
                  Loading workflow…
                </div>
              )}

              {workflowTemplate && workflowTemplate.steps.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-[#7D8590] uppercase tracking-wide mb-1.5">
                    Workflow: {workflowTemplate.name}
                  </p>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {workflowTemplate.steps.map((step) => (
                      <div key={step.id} className="bg-[#0D1117] border border-[#21262D] rounded-lg px-3 py-2">
                        <p className="text-xs font-medium text-[#E6EDF3] mb-1">{step.title}</p>
                        {step.tasks.length > 0 && (
                          <div className="space-y-0.5">
                            {step.tasks.map((task) => (
                              <div key={task.id} className="flex items-start gap-1.5">
                                <span className="text-[#484F58] text-xs mt-px">·</span>
                                <span className="text-[11px] text-[#7D8590]">{task.title}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Custom instructions */}
          <div>
            <label className="block text-[10px] font-medium text-[#7D8590] mb-1.5 uppercase tracking-wide">
              Custom Instructions <span className="normal-case text-[#484F58] font-normal">(optional)</span>
            </label>
            <textarea
              value={customInstructions}
              onChange={(e) => {
                setCustomInstructions(e.target.value);
                localStorage.setItem("gfs-custom-instructions", e.target.value);
              }}
              rows={2}
              placeholder="e.g. Use PnP PowerShell module. Client uses a hybrid setup. Always include verbose logging…"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors resize-none"
            />
          </div>

          {/* Human-only workflow result (shown when no tasks can be automated) */}
          {humanOnlyExplanation && (
            <div className="bg-[#161B22] border border-amber-800/50 rounded-lg px-3 py-2.5">
              <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-1">
                No automation available for this service
              </p>
              <p className="text-[11px] text-[#7D8590] leading-relaxed">{humanOnlyExplanation}</p>
            </div>
          )}

          {/* Package result panel — shown after successful package generation */}
          {packageResult && (
            <div className="bg-[#0D1117] border border-[#0078D4]/40 rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[#21262D] bg-[#0078D4]/10">
                <svg className="w-3.5 h-3.5 text-[#58A6FF] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M10 12v4m4-4v4" /></svg>
                <p className="text-[11px] font-semibold text-[#58A6FF] flex-1">Package generated — {packageResult.modules.length} module{packageResult.modules.length !== 1 ? "s" : ""}</p>
                <span className="text-[10px] text-[#7D8590] truncate max-w-[180px]">{packageResult.title}</span>
              </div>
              <div className="divide-y divide-[#21262D]">
                {packageResult.modules.map((m) => {
                  const status = pushStatuses[m.filename] ?? "idle";
                  return (
                    <div key={m.filename} className="flex items-center gap-2.5 px-3 py-2">
                      {status === "idle" && <div className="w-3.5 h-3.5 rounded-full border border-[#30363D] flex-shrink-0" />}
                      {status === "pushing" && <div className="w-3.5 h-3.5 border-2 border-[#58A6FF]/40 border-t-[#58A6FF] rounded-full animate-spin flex-shrink-0" />}
                      {status === "done" && <svg className="w-3.5 h-3.5 text-[#3FB950] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                      {status === "error" && <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>}
                      <span className="text-[11px] font-mono text-[#E6EDF3] flex-1">{m.filename}</span>
                      {m.description && <span className="text-[10px] text-[#7D8590] truncate max-w-[200px]">{m.description}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Human-only tasks result (shown after generation attempt if any) */}
          {humanOnlyTasks.length > 0 && (
            <div className="bg-[#0D1117] border border-[#21262D] rounded-lg px-3 py-2.5">
              <p className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide mb-1.5">
                Human-only tasks (not automated)
              </p>
              <div className="space-y-0.5">
                {humanOnlyTasks.map((t, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <svg className="w-3 h-3 text-[#484F58] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    <span className="text-[11px] text-[#7D8590]">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#21262D] flex-shrink-0 gap-3">
          <p className="text-[10px] text-[#484F58] leading-relaxed">
            {packageResult
              ? "Each module will be created/updated as its own Azure Automation runbook."
              : "AI classifies M365/Azure-automatable tasks and generates production-ready scripts. Human-only tasks are listed but not automated."}
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            {packageResult ? (
              <>
                <button
                  onClick={handleDonePackage}
                  disabled={pushing}
                  className="px-3 py-1.5 text-xs text-[#7D8590] hover:text-[#E6EDF3] rounded border border-[#30363D] hover:bg-[#21262D] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Done
                </button>
                <button
                  onClick={handlePushPackageToAzure}
                  disabled={pushing}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#0078D4]/20 border border-[#0078D4]/40 text-[#58A6FF] hover:bg-[#0078D4]/30 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
                >
                  {pushing ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-[#58A6FF]/40 border-t-[#58A6FF] rounded-full animate-spin" />
                      Pushing…
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      Push to Azure
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                <button onClick={onClose} className="px-3 py-1.5 text-xs text-[#7D8590] hover:text-[#E6EDF3] rounded border border-[#30363D] hover:bg-[#21262D] transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!selectedServiceId || !hasContext || generating}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-teal-600/20 border border-teal-500/40 text-teal-400 hover:bg-teal-600/30 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
                >
                  {generating ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-teal-400/40 border-t-teal-400 rounded-full animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Generate Scripts
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <GeneratingProgressDialog open={generating} />
    </div>
  );
}

// ─── Bottom Panel ─────────────────────────────────────────────────────────────

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
  onOpenGenerateFromService,
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
  onOpenGenerateFromService: () => void;
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
            <div className="flex items-center gap-2">
              <button onClick={onGenerate} disabled={generating} className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#0086EF] disabled:opacity-50 text-white text-xs font-semibold py-1.5 px-4 rounded transition-colors">
                {generating ? <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Generating…</> : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Generate Script</>}
              </button>
              <button
                onClick={onOpenGenerateFromService}
                disabled={generating}
                title="Generate from a service workflow — AI classifies and automates M365/Azure tasks"
                className="flex items-center gap-1.5 bg-teal-600/20 border border-teal-500/40 text-teal-400 hover:bg-teal-600/30 disabled:opacity-50 text-xs font-semibold py-1.5 px-3 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                From Service
              </button>
            </div>
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
  const [azurePushDialog, setAzurePushDialog] = useState<AzurePushDialogState>({
    open: false,
    stepStatus: ["idle", "idle", "idle"],
    error: null,
  });
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
  const [generateFromServiceOpen, setGenerateFromServiceOpen] = useState(false);

  // ── Library state ───────────────────────────────────────────────────────────
  const [scripts, setScripts] = useState<PsScriptListItem[]>([]);
  const [packages, setPackages] = useState<ScriptPackageListItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [loadingScriptId, setLoadingScriptId] = useState<string | null>(null);
  const [openDrawerScriptId, setOpenDrawerScriptId] = useState<string | null>(null);
  const [openDrawerPackage, setOpenDrawerPackage] = useState<ScriptPackageListItem | null>(null);
  const [loadedPackageTitle, setLoadedPackageTitle] = useState<string | null>(null);
  const [loadedPackageId, setLoadedPackageId] = useState<string | null>(null);

  // ── Run result detail state ──────────────────────────────────────────────────
  const [selectedResult, setSelectedResult] = useState<RunResult | null>(null);

  // ── IDE panel layout state ───────────────────────────────────────────────────
  const leftPanel = useResize(IDE_LEFT_WIDTH_KEY, 240, 140, 400);
  const rightPanel = useResize(IDE_RIGHT_WIDTH_KEY, 260, 160, 420);
  const bottomPanel = useResize(IDE_BOTTOM_HEIGHT_KEY, 220, 100, 450);

  const [leftCollapsed, setLeftCollapsed] = useState(() => lsGet(IDE_LEFT_COLLAPSED_KEY, "false") === "true");
  const [rightVisible, setRightVisible] = useState(() => lsGet(IDE_RIGHT_VISIBLE_KEY, "true") === "true");
  const [leftMode, setLeftMode] = useState<"library" | "catalog" | "results">(() =>
    (lsGet(IDE_LEFT_MODE_KEY, "library") as "library" | "catalog" | "results")
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rightActiveTab, setRightActiveTab] = useState<"runner" | "permissions">(() =>
    (lsGet(IDE_RIGHT_TAB_KEY, "runner") as "runner" | "permissions")
  );
  const [catalogPresetRunbook, setCatalogPresetRunbook] = useState<string | null>(null);

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

  // Fullscreen Escape key handler
  useEffect(() => {
    if (!isFullscreen) return;
    const handle = (e: KeyboardEvent) => { if (e.key === "Escape") setIsFullscreen(false); };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [isFullscreen]);

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

  const handleCatalogRunScript = (runbookName: string) => {
    setCatalogPresetRunbook(runbookName);
    setRightActiveTab("runner");
    lsSet(IDE_RIGHT_TAB_KEY, "runner");
    if (!rightVisible) {
      setRightVisible(true);
      lsSet(IDE_RIGHT_VISIBLE_KEY, "true");
    }
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

    setAzurePushDialog({ open: true, stepStatus: ["running", "idle", "idle"], error: null });

    const scriptId = editorScript.id;

    type PushResult = { ok: boolean; warning?: string; azureSyncedAt?: string };
    type PushOutcome = { data: PushResult | null; error: string | null };

    const apiCall: Promise<PushOutcome> = apiFetch(
      `/admin/ps-scripts/${scriptId}/push-to-azure`,
      token,
      { method: "POST" },
    ).then(d => ({ data: d as PushResult | null, error: null }))
      .catch(err => ({ data: null, error: err instanceof Error ? err.message : "Push to Azure failed" }));

    await new Promise(resolve => setTimeout(resolve, 800));

    setAzurePushDialog(prev => ({ ...prev, stepStatus: ["done", "running", "idle"] }));

    const outcome = await apiCall;

    if (outcome.error) {
      setAzurePushDialog(prev => ({ ...prev, stepStatus: ["done", "error", "idle"], error: outcome.error }));
      return;
    }

    if (outcome.data && !outcome.data.ok && outcome.data.warning) {
      setAzurePushDialog(prev => ({ ...prev, stepStatus: ["done", "error", "idle"], error: outcome.data!.warning ?? "Push skipped" }));
      return;
    }

    setAzurePushDialog(prev => ({ ...prev, stepStatus: ["done", "done", "done"] }));

    setTimeout(() => {
      setAzurePushDialog(prev => ({ ...prev, open: false }));
    }, 2000);
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

  const handleSidebarPackageClick = (pkg: ScriptPackageListItem) => {
    setOpenDrawerPackage(null);
    setModules(pkg.modules);
    setLoadedPackageTitle(pkg.title);
    setLoadedPackageId(pkg.id);
    setEditorScript(null);
    setSelectedResult(null);
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
  const scriptLoaded = scriptBody.length > 0 || modules.length > 0;

  return (
    <div className={`flex flex-col overflow-hidden bg-[#0D1117] ${isFullscreen ? "fixed inset-0 z-[100]" : "h-full"}`}>
      {/* ── IDE body ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ── Left panel ──────────────────────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden flex-shrink-0" style={{ width: effectiveLeftWidth }}>
          {leftCollapsed ? (
            /* Collapsed strip */
            <div className="flex flex-col items-center py-3 gap-2 border-r border-[#21262D] bg-[#0D1117]" style={{ width: 40 }}>
              <button onClick={toggleLeftCollapsed} title="Expand sidebar" className="p-1.5 text-[#484F58] hover:text-[#E6EDF3] rounded transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
              <div className="w-px flex-1 bg-[#21262D]" />
              <span className="text-[8px] text-[#484F58] font-bold tracking-widest uppercase" style={{ writingMode: "vertical-rl" }}>
                {leftMode === "library" ? "LIBRARY" : leftMode === "catalog" ? "CATALOG" : "RESULTS"}
              </span>
            </div>
          ) : (
            /* Expanded: mode toggle + panel body */
            <div className="flex flex-col border-r border-[#21262D] bg-[#0D1117] overflow-hidden h-full">
              {/* Mode toggle header */}
              <div className="flex items-center flex-shrink-0 border-b border-[#21262D] bg-[#0D1117]">
                <button onClick={toggleLeftCollapsed} title="Collapse sidebar" className="p-2 text-[#484F58] hover:text-[#E6EDF3] transition-colors flex-shrink-0">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                {(["library", "catalog", "results"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => { setLeftMode(m); lsSet(IDE_LEFT_MODE_KEY, m); }}
                    className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-colors text-center border-b-2 ${
                      leftMode === m
                        ? "text-[#58A6FF] border-[#0078D4]"
                        : "text-[#484F58] hover:text-[#E6EDF3] border-transparent"
                    }`}
                  >
                    {m === "library" ? "Library" : m === "catalog" ? "Catalog" : "Results"}
                  </button>
                ))}
              </div>
              {/* Panel body */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {leftMode === "library" && (
                  <LibrarySidebar
                    scripts={scripts}
                    packages={packages}
                    loading={libraryLoading}
                    onOpenScript={handleSidebarScriptClick}
                    onOpenPackage={handleSidebarPackageClick}
                    loadingScriptId={loadingScriptId}
                  />
                )}
                {leftMode === "catalog" && (
                  <CatalogSidebarPanel onRunScript={handleCatalogRunScript} />
                )}
                {leftMode === "results" && (
                  <RunResultsSidebarPanel
                    onSelectResult={setSelectedResult}
                    selectedResultId={selectedResult?.id ?? null}
                  />
                )}
              </div>
            </div>
          )}
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
                    <button onClick={pushToAzure} disabled={azurePushDialog.open} title="Push to Azure Automation" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-[#0078D4]/30 bg-[#0078D4]/10 text-[#58A6FF] hover:bg-[#0078D4]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
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
                title={rightVisible ? "Hide right panel" : "Show right panel"}
                className={`ml-1 p-1.5 rounded transition-colors flex-shrink-0 ${rightVisible ? "text-[#58A6FF] bg-[#0078D4]/10" : "text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v14a2 2 0 002 2h4m6-4l3-3m0 0l-3-3m3 3H9" /></svg>
              </button>
              {/* Fullscreen toggle */}
              <button
                onClick={() => setIsFullscreen(f => !f)}
                title={isFullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
                className={`p-1.5 rounded transition-colors flex-shrink-0 ${isFullscreen ? "text-[#58A6FF] bg-[#0078D4]/10" : "text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}
              >
                {isFullscreen ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                )}
              </button>
            </div>

            {/* Editor body */}
            {selectedResult ? (
              <RunResultDetailPanel
                result={selectedResult}
                onClose={() => setSelectedResult(null)}
                onMarkReviewed={(id, reviewedAt) =>
                  setSelectedResult(prev => prev?.id === id ? { ...prev, reviewedAt } : prev)
                }
                onUploaded={(id) =>
                  setSelectedResult(prev => prev?.id === id ? { ...prev, status: "completed" as const } : prev)
                }
              />
            ) : modules.length > 0 ? (
              <ModulePackageView
                modules={modules}
                packageTitle={loadedPackageTitle ?? (prompt.trim() || "package")}
                packageId={loadedPackageId}
                token={token}
                onBack={() => { setModules([]); setLoadedPackageTitle(null); setLoadedPackageId(null); }}
                onDeleted={(id) => {
                  setPackages((prev) => prev.filter((p) => p.id !== id));
                  setModules([]);
                  setLoadedPackageTitle(null);
                  setLoadedPackageId(null);
                }}
              />
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
                  extensions={[StreamLanguage.define(powerShell), ...powershellExtensions]}
                  theme={oneDark}
                  basicSetup={{
                    lineNumbers: true,
                    highlightActiveLine: true,
                    highlightActiveLineGutter: true,
                    foldGutter: true,
                    autocompletion: true,
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
          {!selectedResult && (
            <div
              onMouseDown={startBottomResize}
              className="h-1 cursor-row-resize bg-[#21262D] hover:bg-[#0078D4]/50 transition-colors flex-shrink-0"
              title="Drag to resize"
            />
          )}

          {/* Bottom panel */}
          {!selectedResult && (
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
                onOpenGenerateFromService={() => setGenerateFromServiceOpen(true)}
              />
            </div>
          )}
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
            <RightPanel
              permissions={permissions}
              scriptLoaded={scriptLoaded}
              scriptBody={scriptBody}
              editorScript={editorScript}
              activeTab={rightActiveTab}
              onActiveTabChange={(t) => { setRightActiveTab(t); lsSet(IDE_RIGHT_TAB_KEY, t); }}
              presetRunbook={catalogPresetRunbook}
              onPresetConsumed={() => setCatalogPresetRunbook(null)}
            />
          </div>
        )}
      </div>

      {/* ── Modals & Drawers ──────────────────────────────────────────────── */}
      <GeneratingProgressDialog open={generating} />

      {generateFromServiceOpen && (
        <GenerateFromServiceDialog
          token={token}
          baseInstructions={baseInstructions}
          detailedInstructions={detailedInstructions}
          onClose={() => setGenerateFromServiceOpen(false)}
          onScriptGenerated={(title, script, perms) => {
            setScriptBody(script);
            cleanBodyRef.current = script;
            setPermissions(perms);
            setEditorScript(null);
            setModules([]);
            setFixSummary("");
            setSummaryError(null);
            toast({ title: "Script generated", description: title });
          }}
          onPackageGenerated={(packageId, title, mods, perms) => {
            const pkg: ScriptPackageListItem = {
              id: packageId,
              title,
              category: "m365",
              permissions: perms,
              tags: [],
              createdAt: new Date().toISOString(),
              modules: mods,
            };
            setPackages((prev) => [pkg, ...prev]);
            setModules(mods);
            setPermissions(perms);
            setEditorScript(null);
            setFixSummary("");
            setSummaryError(null);
            toast({ title: "Package generated", description: title });
          }}
        />
      )}

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

      <AzurePushDialog
        state={azurePushDialog}
        onClose={() => setAzurePushDialog(prev => ({ ...prev, open: false }))}
      />
    </div>
  );
}
