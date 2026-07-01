import { useState, useCallback, useEffect, useRef } from "react";
import SyntaxErrorAlert from "@/components/SyntaxErrorAlert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AzurePushDialog, type AzurePushDialogState } from "@/components/AzurePushDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import RunLibraryScriptDialog from "@/components/RunLibraryScriptDialog";
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

interface AppPermEntry {
  scope: string;
  reason: string;
}

interface AppPermDetail {
  name: string;
  description: string;
}

interface PsScriptPermissions {
  appPermissions: AppPermEntry[];
  delegatedPermissions: string[];
  notes: string;
  appPermissionDetails?: AppPermDetail[];
  delegatedPermissionDetails?: AppPermDetail[];
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
  sourceTaskId?: number | null;
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
  azureRunbookName?: string | null;
  permissions?: PsScriptPermissions;
  sourceTaskIds?: number[] | null;
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

class ApiError extends Error {
  aiResponse?: string;
  constructor(message: string, aiResponse?: string) {
    super(message);
    this.name = "ApiError";
    this.aiResponse = aiResponse;
  }
}

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
    const body = await res.json().catch(() => ({ error: "Request failed" })) as { error?: string; aiResponse?: string };
    throw new ApiError(body.error ?? `HTTP ${res.status}`, body.aiResponse);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── SSE streaming helper for generation endpoints ────────────────────────────

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function consumeGenerationSSE<T>(
  path: string,
  fetchFn: FetchFn,
  body: Record<string, unknown>,
  onUpdate: (pct: number, label: string) => void,
): Promise<T> {
  const res = await fetchFn(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string; aiResponse?: string };
    throw new ApiError(json.error ?? `HTTP ${res.status}`, json.aiResponse);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  return new Promise<T>((resolve, reject) => {
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { reject(new Error("Stream ended without completion")); return; }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            let evt: Record<string, unknown>;
            try { evt = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }
            const evtType = evt["type"] as string | undefined;
            if (evtType === "phase" || evtType === "progress") {
              onUpdate(
                typeof evt["pct"] === "number" ? evt["pct"] : 0,
                typeof evt["label"] === "string" ? evt["label"] : "",
              );
            } else if (evtType === "done") {
              resolve(evt["payload"] as T);
              return;
            } else if (evtType === "error") {
              reject(new ApiError(
                typeof evt["message"] === "string" ? evt["message"] : "Generation failed",
                typeof evt["aiResponse"] === "string" ? evt["aiResponse"] : undefined,
              ));
              return;
            }
          }
        }
      } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    })();
  });
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

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  destructive = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent className="bg-[#0D1117] border border-[#30363D] text-[#E6EDF3] shadow-2xl max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[#E6EDF3] text-base font-semibold">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[#8B949E] text-sm leading-relaxed">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm font-medium text-[#C9D1D9] bg-[#21262D] border border-[#30363D] rounded-lg hover:bg-[#30363D] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
              destructive
                ? "bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25"
                : "bg-[#0078D4]/15 border border-[#0078D4]/30 text-[#58A6FF] hover:bg-[#0078D4]/25"
            }`}
          >
            {confirmLabel}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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

// ─── New Script Set dialog ────────────────────────────────────────────────────

function NewScriptSetDialog({
  open,
  token,
  onCreated,
  onClose,
}: {
  open: boolean;
  token: string;
  onCreated: (pkg: ScriptPackageListItem) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  const [tagsRaw, setTagsRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reset = () => { setName(""); setCategory("other"); setTagsRaw(""); setError(""); setSaving(false); };

  const handleOpenChange = (o: boolean) => { if (!o) { reset(); onClose(); } };

  const handleSubmit = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
      const result = await apiFetch("/admin/ps-scripts/packages", token, {
        method: "POST",
        body: JSON.stringify({ title: name.trim(), category, tags }),
      }) as ScriptPackageListItem;
      reset();
      onCreated(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create set");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-[#161B22] border border-[#30363D] text-[#E6EDF3] shadow-2xl max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-[#E6EDF3] flex items-center gap-2">
            <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            New Script Set
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <label className="block text-xs font-medium text-[#8B949E] mb-1">Name <span className="text-red-400">*</span></label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSubmit(); }}
              placeholder="e.g. Monthly Audit, Onboarding Checklist"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#8B949E] mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 transition-colors appearance-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#8B949E] mb-1">Tags <span className="text-[#484F58]">(comma-separated, optional)</span></label>
            <input
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="e.g. audit, monthly, security"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 transition-colors"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            onClick={() => { reset(); onClose(); }}
            className="px-4 py-2 text-sm font-medium text-[#7D8590] hover:text-[#E6EDF3] border border-[#30363D] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors flex items-center gap-2"
          >
            {saving ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Creating…</>
            ) : "Create Set"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
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

  const handleDelete = () => {
    if (!script) return;
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    if (!script) return;
    setDeleteConfirmOpen(false);
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
                      <div className="flex flex-wrap gap-1.5">{script.permissions.appPermissions.map((p) => <PermissionBadge key={p.scope} text={p.scope} />)}</div>
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
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete script?"
        description={script ? `Delete "${script.title}"? This cannot be undone.` : "Delete this script? This cannot be undone."}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}

// ─── Package Drawer ───────────────────────────────────────────────────────────

interface EditableModule extends ScriptModuleItem {
  _key: string;
}

let _editKeyCounter = 0;
function makeEditKey() { return `emod-${++_editKeyCounter}`; }

// ─── Package Push Progress Dialog ─────────────────────────────────────────────
// Pushes each module one-at-a-time so the dialog can show live per-row progress.

type PushableModule = { filename: string; description?: string | null };
type PushStatus = "idle" | "pushing" | "done" | "error";

function PackagePushProgressDialog({
  open,
  packageId,
  modules,
  token,
  onClose,
}: {
  open: boolean;
  packageId: string;
  modules: PushableModule[];
  token: string;
  onClose: () => void;
}) {
  const [statuses, setStatuses] = useState<Record<string, PushStatus>>({});
  const [errors, setErrors]     = useState<Record<string, string>>({});
  const [running, setRunning]   = useState(false);
  const [finished, setFinished] = useState(false);
  const didRun = useRef(false);

  useEffect(() => {
    if (!open) { didRun.current = false; return; }
    if (didRun.current) return;
    didRun.current = true;

    setStatuses(Object.fromEntries(modules.map((m) => [m.filename, "idle" as PushStatus])));
    setErrors({});
    setFinished(false);
    setRunning(true);

    (async () => {
      for (const mod of modules) {
        setStatuses((prev) => ({ ...prev, [mod.filename]: "pushing" }));
        try {
          const data = (await apiFetch(
            `/admin/ps-scripts/packages/${packageId}/push-module`,
            token,
            { method: "POST", body: JSON.stringify({ filename: mod.filename }) },
          )) as { ok: boolean; warning?: string; error?: string };

          if (data.ok) {
            setStatuses((prev) => ({ ...prev, [mod.filename]: "done" }));
          } else {
            setStatuses((prev) => ({ ...prev, [mod.filename]: "error" }));
            setErrors((prev) => ({ ...prev, [mod.filename]: data.warning ?? data.error ?? "Failed" }));
          }
        } catch (e) {
          setStatuses((prev) => ({ ...prev, [mod.filename]: "error" }));
          setErrors((prev) => ({ ...prev, [mod.filename]: e instanceof Error ? e.message : "Push failed" }));
        }
      }
      setRunning(false);
      setFinished(true);
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const doneCount  = Object.values(statuses).filter((s) => s === "done").length;
  const errorCount = Object.values(statuses).filter((s) => s === "error").length;
  const total      = modules.length;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#21262D]">
          <div className="w-8 h-8 rounded-lg bg-[#0078D4]/15 border border-[#0078D4]/30 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#E6EDF3]">Publishing to Azure Automation</h2>
            <p className="text-[10px] text-[#7D8590]">Each module becomes its own runbook</p>
          </div>
        </div>

        {/* Module rows */}
        <div className="px-5 py-4 space-y-1.5 max-h-72 overflow-y-auto">
          {modules.map((m) => {
            const s = statuses[m.filename] ?? "idle";
            return (
              <div key={m.filename} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${s === "done" ? "border-[#3FB950]/30 bg-[#3FB950]/5" : s === "error" ? "border-red-500/30 bg-red-500/5" : s === "pushing" ? "border-[#0078D4]/40 bg-[#0078D4]/8" : "border-[#21262D] bg-[#0D1117]"}`}>
                {/* Status icon */}
                <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                  {s === "idle"    && <div className="w-3.5 h-3.5 rounded-full border border-[#484F58]" />}
                  {s === "pushing" && <div className="w-4 h-4 border-2 border-[#0078D4]/40 border-t-[#0078D4] rounded-full animate-spin" />}
                  {s === "done"    && <svg className="w-4 h-4 text-[#3FB950]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  {s === "error"   && <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-[#E6EDF3] truncate">{m.filename}</p>
                  {m.description && <p className="text-[10px] text-[#7D8590] truncate mt-0.5">{m.description}</p>}
                  {errors[m.filename] && <p className="text-[10px] text-red-400 mt-0.5 truncate">{errors[m.filename]}</p>}
                </div>
                <span className={`text-[10px] font-medium flex-shrink-0 ${s === "done" ? "text-[#3FB950]" : s === "error" ? "text-red-400" : s === "pushing" ? "text-[#58A6FF]" : "text-[#484F58]"}`}>
                  {s === "idle" ? "Waiting" : s === "pushing" ? "Uploading…" : s === "done" ? "Published" : "Failed"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#21262D]">
          <p className="text-[11px] text-[#7D8590]">
            {running
              ? `Publishing ${modules.findIndex((m) => statuses[m.filename] === "pushing") + 1} of ${total}…`
              : finished
                ? errorCount > 0
                  ? `${doneCount} published · ${errorCount} failed`
                  : `All ${total} runbook${total !== 1 ? "s" : ""} published`
                : "Ready"}
          </p>
          <button
            onClick={onClose}
            disabled={running}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg border border-[#30363D] text-[#E6EDF3] hover:bg-[#21262D] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {running ? "Publishing…" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PackageDrawerPushButton({ packageId, token, modules }: { packageId: string; token: string; modules: PushableModule[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#0078D4]/35 bg-[#0078D4]/10 text-[#58A6FF] hover:bg-[#0078D4]/20 transition-colors"
        title="Push each module as its own Azure Automation runbook"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
        Push to Azure
      </button>
      <PackagePushProgressDialog open={open} packageId={packageId} modules={modules} token={token} onClose={() => setOpen(false)} />
    </>
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
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
              azureRunbookName: em.azureRunbookName?.trim() || null,
            }),
          });
          savedModules.push({ id: em.id, filename: em.filename, description: em.description, content: em.content, azureRunbookName: em.azureRunbookName?.trim() || null });
        } else {
          const created = await apiFetch(`/admin/ps-scripts/packages/${pkg.id}/modules`, token, {
            method: "POST",
            body: JSON.stringify({
              filename: em.filename,
              description: em.description,
              content: em.content,
              sortOrder: i,
              azureRunbookName: em.azureRunbookName?.trim() || null,
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
      azureRunbookName: null,
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
  const handleDelete = () => {
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    setDeleteConfirmOpen(false);
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
                <PackageDrawerPushButton packageId={pkg.id} token={token} modules={pkg.modules} />
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
                      {/* Azure Runbook Name */}
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#161B22] border-b border-[#30363D]">
                        <span className="text-[10px] font-medium text-[#484F58] whitespace-nowrap">Azure Runbook</span>
                        <input
                          className="flex-1 bg-[#0D1117] border border-[#30363D] rounded px-2.5 py-1 text-xs font-mono text-[#C9D1D9] focus:outline-none focus:border-[#0078D4]/60 placeholder-[#3D444D]"
                          value={(activeModule as EditableModule).azureRunbookName ?? ""}
                          onChange={(e) => updateEditModule((activeModule as EditableModule)._key, { azureRunbookName: e.target.value || null })}
                          placeholder="e.g. my-onboarding-runbook (leave blank to push script)"
                        />
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
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete package?"
        description={`Delete package "${pkg.title}" and all its modules? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}

// ─── Module Package View (center pane — after modularize) ─────────────────────

function ModulePackageView({
  modules,
  packageTitle,
  token,
  onBack,
  loadedPkg,
  onEdit,
  onDelete,
}: {
  modules: ScriptModuleItem[];
  packageTitle: string;
  token: string;
  onBack: () => void;
  loadedPkg?: ScriptPackageListItem | null;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { toast } = useToast();
  const [activeIdx, setActiveIdx] = useState(0);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const activeModule = modules[activeIdx];
  const packageId = loadedPkg?.id ?? null;

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
          {loadedPkg && onEdit && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors"
              title="Edit this package"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              Edit
            </button>
          )}
          {loadedPkg && onDelete && (
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              title="Delete this package"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              Delete
            </button>
          )}
          {loadedPkg && (
            <button
              onClick={() => setPushDialogOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#0078D4]/15 border border-[#0078D4]/35 text-[#58A6FF] hover:bg-[#0078D4]/25 transition-colors"
              title="Push each module as its own Azure Automation runbook"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              Push to Azure
            </button>
          )}
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
      {packageId && (
        <PackagePushProgressDialog
          open={pushDialogOpen}
          packageId={packageId}
          modules={modules}
          token={token}
          onClose={() => setPushDialogOpen(false)}
        />
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
  onOpenModule,
  loadingScriptId,
  onRunScript,
  onRunModule,
  token,
  onDeleteScript,
  onModuleRemoved,
  onNewSet,
}: {
  scripts: PsScriptListItem[];
  packages: ScriptPackageListItem[];
  loading: boolean;
  onOpenScript: (id: string) => void;
  onOpenPackage: (pkg: ScriptPackageListItem) => void;
  onOpenModule: (module: ScriptModuleItem, pkg: ScriptPackageListItem) => void;
  loadingScriptId: string | null;
  onRunScript?: (script: PsScriptListItem) => void;
  onRunModule?: (module: ScriptModuleItem) => void;
  token: string;
  onDeleteScript?: (scriptId: string) => void;
  onModuleRemoved?: (moduleId: string, packageId: string) => void;
  onNewSet?: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [expandedPackages, setExpandedPackages] = useState<Set<string>>(new Set());
  const [confirmDeleteScript, setConfirmDeleteScript] = useState<PsScriptListItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmRemoveModule, setConfirmRemoveModule] = useState<{ mod: ScriptModuleItem; pkg: ScriptPackageListItem } | null>(null);
  const [removingModuleId, setRemovingModuleId] = useState<string | null>(null);

  const handleAssociate = async (script: PsScriptListItem, pkg: ScriptPackageListItem) => {
    try {
      await apiFetch(`/admin/ps-scripts/${script.id}/associate-to-package`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: pkg.id }),
      });
      toast({ title: "Script added to set", description: `"${script.title}" added to "${pkg.title}" as a new module.` });
    } catch {
      toast({ title: "Failed to associate script", variant: "destructive" });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteScript) return;
    const s = confirmDeleteScript;
    setConfirmDeleteScript(null);
    setDeletingId(s.id);
    try {
      await apiFetch(`/admin/ps-scripts/${s.id}`, token, { method: "DELETE" });
      onDeleteScript?.(s.id);
      toast({ title: "Script deleted", description: `"${s.title}" has been removed from the library.` });
    } catch {
      toast({ title: "Failed to delete script", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const handleRemoveModuleConfirm = async () => {
    if (!confirmRemoveModule) return;
    const { mod, pkg } = confirmRemoveModule;
    setConfirmRemoveModule(null);
    if (!mod.id) return;
    setRemovingModuleId(mod.id);
    try {
      await apiFetch(`/admin/ps-scripts/modules/${mod.id}`, token, { method: "DELETE" });
      onModuleRemoved?.(mod.id, pkg.id);
      toast({ title: "Module removed", description: `"${mod.filename}" has been removed from "${pkg.title}".` });
    } catch {
      toast({ title: "Failed to remove module", variant: "destructive" });
    } finally {
      setRemovingModuleId(null);
    }
  };

  const handleAssignModuleToTask = async (mod: ScriptModuleItem) => {
    if (!mod.id) return;
    try {
      const result = await apiFetch(`/admin/ps-scripts/modules/${mod.id}/assign-tasks`, token, { method: "POST" }) as { assigned: number; message?: string };
      if (result.assigned === 0) {
        toast({ title: "No tasks linked", description: result.message ?? "No source tasks recorded for this module. Re-generate the package to capture task associations.", variant: "destructive" });
      } else {
        toast({ title: `Assigned to ${result.assigned} task${result.assigned === 1 ? "" : "s"}`, description: `"${mod.filename}" is now the runbook for its source workflow task${result.assigned === 1 ? "" : "s"}.` });
      }
    } catch {
      toast({ title: "Failed to assign module to task", variant: "destructive" });
    }
  };

  const handleAssignScriptToTask = async (s: PsScriptListItem) => {
    try {
      const result = await apiFetch(`/admin/ps-scripts/${s.id}/assign-task`, token, { method: "POST" }) as { assigned: number; message?: string };
      if (result.assigned === 0) {
        toast({ title: "No task linked", description: result.message ?? "This script has no source task recorded. Generate it via the workflow task button to create the link.", variant: "destructive" });
      } else {
        toast({ title: "Assigned to workflow task", description: `"${s.title}" is now the runbook for its source workflow task.` });
      }
    } catch {
      toast({ title: "Failed to assign script to task", variant: "destructive" });
    }
  };

  const togglePackageExpand = (pkgId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedPackages((prev) => {
      const next = new Set(prev);
      if (next.has(pkgId)) next.delete(pkgId); else next.add(pkgId);
      return next;
    });
  };

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
      {/* Search + New Set button */}
      <div className="px-2 py-2 flex-shrink-0 border-b border-[#21262D] flex items-center gap-1.5">
        <div className="relative flex-1">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#484F58]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter…" className="w-full bg-[#161B22] border border-[#30363D] rounded pl-6 pr-2 py-1 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/50 transition-colors" />
        </div>
        {onNewSet && (
          <button
            onClick={onNewSet}
            title="New Script Set"
            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/25 rounded hover:bg-purple-500/20 hover:text-purple-300 transition-colors whitespace-nowrap"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            New Script Set
          </button>
        )}
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
                    <div
                      key={`s-${s.id}`}
                      className="flex items-center min-w-0 hover:bg-[#161B22] transition-colors group"
                    >
                      <button
                        onClick={() => onOpenScript(s.id)}
                        className="flex-1 flex items-center gap-2 pl-7 pr-1 py-1 text-left min-w-0 overflow-hidden"
                        title={s.title}
                      >
                        {isLoading ? (
                          <div className="w-3 h-3 border border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                        ) : (
                          <svg className="w-3 h-3 text-[#484F58] group-hover:text-[#58A6FF] flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        )}
                        <span className="flex-1 text-xs text-[#C9D1D9] truncate min-w-0">{s.title}</span>
                        {!s.sourceTaskId && (
                          <span title="Not linked to a task" className="flex-shrink-0">
                            <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                          </span>
                        )}
                        {s.tags?.includes("manual") && (
                          <span className="flex-shrink-0 text-[8px] font-semibold px-1 py-0.5 rounded bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 uppercase tracking-wide">M</span>
                        )}
                      </button>
                      {deletingId === s.id ? (
                        <div className="flex-shrink-0 px-2 py-1">
                          <div className="w-3 h-3 border border-[#484F58] border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              title="More actions"
                              className="flex-shrink-0 opacity-0 group-hover:opacity-100 px-1.5 py-1 text-[#484F58] hover:text-[#C9D1D9] transition-all rounded hover:bg-[#21262D]"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="2" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="14" r="1.5" /></svg>
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            className="bg-[#1C2128] border-[#30363D] text-[#C9D1D9] min-w-[180px]"
                            side="right"
                            align="start"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {onRunScript && (
                              <DropdownMenuItem
                                className="text-xs text-[#C9D1D9] focus:bg-[#21262D] focus:text-[#E6EDF3] gap-2 cursor-pointer"
                                onSelect={() => onRunScript(s)}
                              >
                                <svg className="w-3 h-3 text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                Run
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger
                                disabled={packages.length === 0}
                                className="text-xs text-[#C9D1D9] focus:bg-[#21262D] focus:text-[#E6EDF3] data-[state=open]:bg-[#21262D] data-[disabled]:opacity-40 gap-2"
                              >
                                <svg className="w-3 h-3 text-purple-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                                Associate to Script Set
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="bg-[#1C2128] border-[#30363D] text-[#C9D1D9] max-w-[220px]">
                                {packages.map(pkg => (
                                  <DropdownMenuItem
                                    key={pkg.id}
                                    className="text-xs text-[#C9D1D9] focus:bg-[#21262D] focus:text-[#E6EDF3] gap-2 cursor-pointer"
                                    onSelect={() => void handleAssociate(s, pkg)}
                                  >
                                    <span className="flex-1 truncate">{pkg.title}</span>
                                    <span className="text-[9px] text-purple-500/60 flex-shrink-0">{pkg.modules.length}m</span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuItem
                              className="text-xs text-[#C9D1D9] focus:bg-[#21262D] focus:text-[#E6EDF3] gap-2 cursor-pointer"
                              onSelect={() => onOpenScript(s.id)}
                            >
                              <svg className="w-3 h-3 text-[#58A6FF] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                              Properties
                            </DropdownMenuItem>
                            {s.sourceTaskId && (
                              <DropdownMenuItem
                                className="text-xs text-violet-400 focus:bg-violet-500/10 focus:text-violet-300 gap-2 cursor-pointer"
                                onSelect={() => void handleAssignScriptToTask(s)}
                              >
                                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                Assign to Task
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator className="bg-[#30363D]" />
                            <DropdownMenuItem
                              className="text-xs text-red-400 focus:bg-red-500/10 focus:text-red-400 gap-2 cursor-pointer"
                              onSelect={() => setConfirmDeleteScript(s)}
                            >
                              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  );
                } else {
                  const p = entry.item;
                  const isExpanded = expandedPackages.has(p.id);
                  return (
                    <div key={`p-${p.id}-${i}`}>
                      <div className="w-full flex items-center min-w-0 hover:bg-[#161B22] transition-colors group">
                        {/* Chevron toggle */}
                        <button
                          onClick={(e) => togglePackageExpand(p.id, e)}
                          className="pl-7 pr-1 py-1 flex-shrink-0 text-[#484F58] hover:text-[#E6EDF3] transition-colors"
                          title={isExpanded ? "Collapse modules" : "Expand modules"}
                        >
                          <svg
                            className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                        {/* Package row — clicking loads multi-module view */}
                        <button
                          onClick={() => onOpenPackage(p)}
                          className="flex-1 flex items-center gap-2 pr-3 py-1 text-left min-w-0 overflow-hidden"
                          title={p.title}
                        >
                          <svg className="w-3 h-3 text-purple-500/70 group-hover:text-purple-400 flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                          <span className="flex-1 text-xs text-[#C9D1D9] truncate min-w-0">{p.title}</span>
                          <span className="text-[9px] text-purple-500/60 flex-shrink-0">{p.modules.length}m</span>
                        </button>
                      </div>
                      {/* Module child rows */}
                      {isExpanded && p.modules.map((mod) => {
                        const isRemovingThisMod = removingModuleId === mod.id;
                        return (
                          <div
                            key={`mod-${mod.id ?? mod.filename}`}
                            className="flex items-center min-w-0 hover:bg-[#161B22] transition-colors group border-l border-purple-500/20"
                            style={{ marginLeft: 28 }}
                          >
                            <button
                              onClick={() => onOpenModule(mod, p)}
                              className="flex-1 flex items-center gap-2 pl-12 pr-1 py-1 text-left min-w-0 overflow-hidden"
                              title={mod.filename}
                            >
                              <svg className="w-3 h-3 text-[#484F58] group-hover:text-purple-400 flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                              </svg>
                              <span className="flex-1 text-xs text-[#8B949E] group-hover:text-[#C9D1D9] truncate min-w-0 font-mono">{mod.filename}</span>
                              {!mod.sourceTaskIds?.length && (
                                <span title="Not linked to a task" className="flex-shrink-0">
                                  <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                </span>
                              )}
                            </button>
                            {isRemovingThisMod ? (
                              <div className="flex-shrink-0 px-2 py-1">
                                <div className="w-3 h-3 border border-[#484F58] border-t-transparent rounded-full animate-spin" />
                              </div>
                            ) : (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    onClick={(e) => e.stopPropagation()}
                                    title="More actions"
                                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 px-1.5 py-1 text-[#484F58] hover:text-[#C9D1D9] transition-all rounded hover:bg-[#21262D]"
                                  >
                                    <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="2" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="14" r="1.5" /></svg>
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  className="bg-[#1C2128] border-[#30363D] text-[#C9D1D9] min-w-[180px]"
                                  side="right"
                                  align="start"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {onRunModule && mod.id && (
                                    <DropdownMenuItem
                                      className="text-xs text-[#C9D1D9] focus:bg-[#21262D] focus:text-[#E6EDF3] gap-2 cursor-pointer"
                                      onSelect={() => onRunModule(mod)}
                                    >
                                      <svg className="w-3 h-3 text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                      Run
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem
                                    className="text-xs text-[#C9D1D9] focus:bg-[#21262D] focus:text-[#E6EDF3] gap-2 cursor-pointer"
                                    onSelect={() => onOpenModule(mod, p)}
                                  >
                                    <svg className="w-3 h-3 text-[#58A6FF] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                                    Open in Editor
                                  </DropdownMenuItem>
                                  {mod.id && (
                                    <DropdownMenuItem
                                      className="text-xs text-[#C9D1D9] focus:bg-[#21262D] focus:text-[#E6EDF3] gap-2 cursor-pointer"
                                      onSelect={() => void handleAssignModuleToTask(mod)}
                                    >
                                      <svg className="w-3 h-3 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                      Assign to Task
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator className="bg-[#30363D]" />
                                  <DropdownMenuItem
                                    className="text-xs gap-2 cursor-pointer text-red-400 focus:bg-red-500/10 focus:text-red-400 data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed"
                                    onSelect={() => mod.id && setConfirmRemoveModule({ mod, pkg: p })}
                                    disabled={!mod.id}
                                  >
                                    <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" /></svg>
                                    Remove from Set
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                }
              })}
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={!!confirmDeleteScript}
        title={`Delete "${confirmDeleteScript?.title ?? ""}"?`}
        description="This will permanently remove the script from the library. This action cannot be undone."
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setConfirmDeleteScript(null)}
      />
      <ConfirmDialog
        open={!!confirmRemoveModule}
        title={`Remove "${confirmRemoveModule?.mod.filename ?? ""}" from set?`}
        description={`This will detach the module from "${confirmRemoveModule?.pkg.title ?? ""}". The underlying script is not deleted.`}
        onConfirm={() => void handleRemoveModuleConfirm()}
        onCancel={() => setConfirmRemoveModule(null)}
      />
    </div>
  );
}

// ─── Inline Script Runner (right panel) ──────────────────────────────────────

interface InlineClientEntry {
  id: number;
  name: string;
  appRegistration: { id: number; tenantId: string; azureClientId: string; keyVaultSecretName: string; status: string } | null;
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
  governanceAreas,
}: {
  scriptBody: string;
  editorScript: PsScriptDetail | null;
  governanceAreas?: string[];
}) {
  const { fetchWithAuth } = useAuth();

  const [clients, setClients]           = useState<InlineClientEntry[]>([]);
  const [runbooks, setRunbooks]         = useState<InlineRunbookEntry[]>([]);
  const [loadingClients, setLoadingClients]   = useState(true);
  const [loadingRunbooks, setLoadingRunbooks] = useState(false);
  const [azureConfigured, setAzureConfigured] = useState<boolean | null>(null);

  const [selectedClientId, setSelectedClientId] = useState<number | "">("");
  const [selectedRunbook,  setSelectedRunbook]  = useState("");

  const [running,   setRunning]   = useState(false);
  const [jobStatus, setJobStatus] = useState("Never run");
  const [logLines,  setLogLines]  = useState<string[]>([]);
  const logEndRef   = useRef<HTMLDivElement>(null);
  const abortedRef  = useRef(false);

  const [aiAnalysis,     setAiAnalysis]     = useState<InlineAIAnalysis | null>(null);
  const [analyzingAI,    setAnalyzingAI]    = useState(false);
  const [aiError,        setAiError]        = useState<string | null>(null);
  const [aiTab,          setAiTab]          = useState<keyof InlineAIAnalysis>("summary");
  const [copiedConsole,  setCopiedConsole]  = useState(false);

  const [validating,    setValidating]    = useState(false);
  const [syntaxErrors,  setSyntaxErrors]  = useState<Array<{ line: number; column: number; message: string }>>([]);

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
          const data = await res.json() as Array<{ id: number; name: string; email: string; appRegistration: { id: number; tenantId: string; azureClientId: string; keyVaultSecretName: string; status: string } | null }>;
          setClients(data.map(c => ({ id: c.id, name: c.name, appRegistration: c.appRegistration ?? null })));
        }
      } finally { setLoadingClients(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load runbooks when a client with an App Registration is selected
  useEffect(() => {
    if (!selectedClientId) { setRunbooks([]); setSelectedRunbook(""); return; }
    const client = clients.find(c => c.id === selectedClientId);
    if (!client?.appRegistration) { setRunbooks([]); setSelectedRunbook(""); return; }
    void (async () => {
      setLoadingRunbooks(true);
      try {
        const res = await fetchWithAuth("/api/admin/runbooks");
        const data = await res.json() as { configured: boolean; runbooks?: InlineRunbookEntry[] };
        if (res.ok && data.configured) {
          setAzureConfigured(true);
          const list = data.runbooks ?? [];
          setRunbooks(list);
          // Pre-select: the editor script's runbook if available.
          // (auto-select ADHOC_SENTINEL when nothing is pre-selected is handled in the separate effect below)
          if (editorScript?.azureRunbookName) {
            setSelectedRunbook(editorScript.azureRunbookName);
          }
        } else if (res.status === 503) {
          setAzureConfigured(false);
        }
      } catch { /* ignore */ }
      finally { setLoadingRunbooks(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId, clients]);

  // Auto-select ADHOC_SENTINEL when runbooks finish loading if editor has content
  // and no runbook is pre-selected (mirrors m365-scripts behaviour)
  useEffect(() => {
    if (!loadingRunbooks && runbooks.length >= 0 && selectedRunbook === "" && scriptBody.trim().length > 0) {
      setSelectedRunbook(ADHOC_SENTINEL);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingRunbooks]);

  const handleRun = async () => {
    const appRegId = selectedClient?.appRegistration?.id;
    if (!appRegId || !selectedRunbook) return;
    const isAdHoc = selectedRunbook === ADHOC_SENTINEL;
    if (isAdHoc && !scriptBody.trim()) return;
    const actualRunbook = isAdHoc
      ? (editorScript?.azureRunbookName ?? ADHOC_RUNBOOK_NAME)
      : selectedRunbook;

    // Pre-flight: validate PowerShell syntax for ad-hoc runs (local script body)
    if (isAdHoc && scriptBody.trim()) {
      setSyntaxErrors([]);
      setValidating(true);
      try {
        const valRes = await fetchWithAuth("/api/admin/scripts/validate-syntax", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: scriptBody }),
        });
        if (valRes.ok) {
          const valData = await valRes.json() as { valid: boolean; skipped?: boolean; errors?: Array<{ line: number; column: number; message: string }> };
          if (!valData.valid && valData.errors && valData.errors.length > 0) {
            setSyntaxErrors(valData.errors);
            setValidating(false);
            return;
          }
        }
      } catch {
        // validation request failed — proceed anyway so a network hiccup doesn't block the run
      } finally {
        setValidating(false);
      }
    }

    setRunning(true);
    setLogLines(isAdHoc ? ["[Uploading current script to Azure…]"] : ["[Starting job…]"]);
    setJobStatus("New");
    setAiAnalysis(null);
    setAiError(null);

    try {
      const areasPayload = Array.isArray(governanceAreas) && governanceAreas.length > 0 ? governanceAreas : undefined;
      const body: Record<string, unknown> = {
        appRegistrationId: appRegId,
        ...(areasPayload ? { governanceAreas: areasPayload } : {}),
      };
      if (isAdHoc) {
        body["adHocContent"] = scriptBody;
        // Prefer the editor script's UUID so the route resolves the correct Azure runbook slot
        if (editorScript?.id) body["scriptId"] = editorScript.id;
      } else {
        if (!editorScript?.id) {
          setLogLines(["[Error: Script must be saved and pushed to Azure before running]"]);
          setRunning(false);
          return;
        }
        body["scriptId"] = editorScript.id;
      }
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
      const { jobId, automationRunId } = await res.json() as { jobId: string; automationRunId?: number };
      let lastSeq = -1;

      const poll = async (): Promise<void> => {
        if (abortedRef.current) return;
        try {
          const autoRunParam = automationRunId ? `&automationRunId=${automationRunId}` : "";
          const pollRes = await fetchWithAuth(`/api/admin/runbook-jobs/output?jobId=${encodeURIComponent(jobId)}&since=${lastSeq}${autoRunParam}`);
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
      const res = await fetchWithAuth("/api/admin/scripts/analyze-output", {
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
  const selectedClient = clients.find(c => c.id === selectedClientId);
  const canRun = !!selectedClientId && !!selectedClient?.appRegistration && selectedRunbook !== "" && !running && !(isAdHocSelected && !scriptBody.trim());
  const statusColor = INLINE_JOB_COLORS[jobStatus] ?? "text-[#7D8590]";
  const currentRunbookName = editorScript?.azureRunbookName ?? null;
  const hasEditorContent = scriptBody.trim().length > 0;

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
                setSelectedRunbook("");
              }}
              className="w-full bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/50 transition-colors"
            >
              <option value="">Select customer…</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{!c.appRegistration ? " (no App Registration)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* App Registration — read-only credential info sourced from the client's App Registration */}
        {selectedClientId !== "" && selectedClient && (
          <div>
            <label className="block text-[9px] font-bold uppercase tracking-wider text-[#484F58] mb-1">Credential</label>
            {selectedClient.appRegistration ? (
              <p className="text-[10px] text-[#E6EDF3] bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 truncate">
                {selectedClient.name} — App Registration
                <span className="ml-1.5 text-[#0078D4]">({selectedClient.appRegistration.status})</span>
              </p>
            ) : (
              <p className="text-[10px] text-amber-400">No App Registration — add one in the CRM first.</p>
            )}
          </div>
        )}

        {/* Runbook — only shown when the client has an App Registration */}
        {selectedClientId !== "" && selectedClient?.appRegistration && (
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
            disabled={!canRun || validating}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {validating ? (
              <><div className="w-3 h-3 border border-green-400/40 border-t-green-400 rounded-full animate-spin" />Validating…</>
            ) : running ? (
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

      {/* Syntax error alert */}
      {syntaxErrors.length > 0 && (
        <div className="px-3 pt-2">
          <SyntaxErrorAlert errors={syntaxErrors} onDismiss={() => setSyntaxErrors([])} />
        </div>
      )}

      {/* Log console header */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-[#21262D] bg-[#0D1117]">
        <span className="text-[9px] font-bold uppercase tracking-wider text-[#484F58]">Output</span>
        {logLines.length > 0 && (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(logLines.join("\n")).then(() => {
                setCopiedConsole(true);
                setTimeout(() => setCopiedConsole(false), 2000);
              });
            }}
            className="flex items-center gap-1 text-[10px] text-[#484F58] hover:text-[#E6EDF3] transition-colors"
            title="Copy console output"
          >
            {copiedConsole ? (
              <>
                <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                <span className="text-green-400">Copied</span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                Copy
              </>
            )}
          </button>
        )}
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
  editingModuleId,
  editingPackageId,
  token,
  onPermissionsChange,
  onModulePermissionsSaved,
  activeTab,
  onActiveTabChange,
  bugDescription,
  onBugDescriptionChange,
  fixing,
  fixSummary,
  onFixBug,
  summaryError,
  summaryAiResponse,
  onDismissSummaryError,
  onDismissFixSummary,
  explaining,
  explainText,
  onExplain,
  onDismissExplain,
}: {
  permissions: PsScriptPermissions;
  scriptLoaded: boolean;
  scriptBody: string;
  editorScript: PsScriptDetail | null;
  editingModuleId: string | null;
  editingPackageId: string | null;
  token: string;
  onPermissionsChange: (p: PsScriptPermissions) => void;
  onModulePermissionsSaved?: (moduleId: string, perms: PsScriptPermissions) => void;
  activeTab: "runner" | "permissions" | "bugfix" | "explain";
  onActiveTabChange: (t: "runner" | "permissions" | "bugfix" | "explain") => void;
  bugDescription: string;
  onBugDescriptionChange: (v: string) => void;
  fixing: boolean;
  fixSummary: string;
  onFixBug: () => void;
  summaryError: "generate" | "fix" | null;
  summaryAiResponse: string | null;
  onDismissSummaryError: () => void;
  onDismissFixSummary: () => void;
  explaining: boolean;
  explainText: string;
  onExplain: () => void;
  onDismissExplain: () => void;
}) {
  const switchTab = (t: string) => {
    const tab = t as "runner" | "permissions" | "bugfix" | "explain";
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
        <InlineScriptRunner scriptBody={scriptBody} editorScript={editorScript} />
      </TabsContent>
      <TabsContent
        value="permissions"
        className="flex-1 min-h-0 overflow-hidden flex flex-col mt-0 p-0"
      >
        <PermissionsSidebarPanel
          permissions={scriptLoaded ? permissions : null}
          scriptId={editingModuleId ? null : (editorScript?.id ?? null)}
          moduleId={editingModuleId}
          analyzeScriptId={editorScript?.id ?? null}
          packageId={editingModuleId ? null : editingPackageId}
          token={token}
          onPermissionsChange={onPermissionsChange}
          onModulePermissionsSaved={onModulePermissionsSaved}
        />
      </TabsContent>
      <TabsContent
        value="bugfix"
        className="flex-1 min-h-0 overflow-y-auto flex flex-col mt-0 p-0"
      >
        <div className="p-3 space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2 pb-1 border-b border-[#21262D]">
            <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
            <span className="text-[10px] font-semibold text-[#484F58] uppercase tracking-widest">Fix Bug</span>
          </div>

          {/* Fix error banner */}
          {summaryError === "fix" && (
            <SummaryErrorBanner
              kind="fix"
              aiResponse={summaryAiResponse}
              onRetry={onFixBug}
              onDismiss={onDismissSummaryError}
            />
          )}

          {/* Fix success callout */}
          {fixSummary && (
            <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2.5">
              <svg className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-green-400 mb-0.5">Bug fixed</p>
                <p className="text-[11px] text-green-300/80">{fixSummary}</p>
              </div>
              <button onClick={onDismissFixSummary} className="text-green-400/50 hover:text-green-400 flex-shrink-0 rounded p-0.5 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          )}

          <p className="text-[11px] text-[#7D8590] leading-relaxed">Describe what's wrong and Claude will return a corrected version.</p>

          <div>
            <label className="block text-[10px] font-medium text-[#7D8590] mb-1">Bug description</label>
            <textarea
              value={bugDescription}
              onChange={(e) => onBugDescriptionChange(e.target.value)}
              rows={7}
              placeholder="e.g. The filter for disabled accounts isn't working — it's returning all users instead of only disabled ones…"
              className="w-full bg-[#161B22] border border-[#30363D] rounded px-2.5 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-red-500/50 transition-colors resize-none"
            />
          </div>

          <button
            onClick={onFixBug}
            disabled={fixing || !bugDescription.trim() || !scriptLoaded}
            className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 border border-red-500/30 text-red-400 text-xs font-semibold py-2 px-4 rounded transition-colors"
          >
            {fixing
              ? <><div className="w-3.5 h-3.5 border-2 border-red-400/40 border-t-red-400 rounded-full animate-spin" />Fixing…</>
              : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Fix with Claude</>
            }
          </button>

          {!scriptLoaded && (
            <p className="text-[10px] text-[#484F58] text-center">Generate or open a script first</p>
          )}
        </div>
      </TabsContent>

      <TabsContent
        value="explain"
        className="flex-1 min-h-0 overflow-y-auto flex flex-col mt-0 p-0"
      >
        <div className="p-3 space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2 pb-1 border-b border-[#21262D]">
            <svg className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            <span className="text-[10px] font-semibold text-[#484F58] uppercase tracking-widest">Explain Script</span>
          </div>

          <p className="text-[11px] text-[#7D8590] leading-relaxed">Claude will analyse the current script and explain what it does, what it touches, and what to watch out for.</p>

          {/* Result */}
          {explainText && (
            <div className="relative bg-[#161B22] border border-violet-500/25 rounded-xl p-3">
              <button
                onClick={onDismissExplain}
                className="absolute top-2 right-2 text-[#484F58] hover:text-[#7D8590] rounded p-0.5 transition-colors"
                title="Dismiss"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              <p className="text-[11px] text-[#E6EDF3] leading-relaxed pr-5 whitespace-pre-wrap">{explainText}</p>
            </div>
          )}

          <button
            onClick={onExplain}
            disabled={explaining || !scriptLoaded}
            className="w-full flex items-center justify-center gap-2 bg-violet-500/10 hover:bg-violet-500/20 disabled:opacity-50 border border-violet-500/30 text-violet-400 text-xs font-semibold py-2 px-4 rounded transition-colors"
          >
            {explaining
              ? <><div className="w-3.5 h-3.5 border-2 border-violet-400/40 border-t-violet-400 rounded-full animate-spin" />Analysing…</>
              : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>Explain with Claude</>
            }
          </button>

          {!scriptLoaded && (
            <p className="text-[10px] text-[#484F58] text-center">Generate or open a script first</p>
          )}
        </div>
      </TabsContent>

      {/* Tab strip pinned at the bottom */}
      <TabsList className="flex-shrink-0 h-9 w-full rounded-none border-t border-[#21262D] bg-[#161B22] p-0 gap-0 justify-start">
        <TabsTrigger
          value="runner"
          className="h-full px-3 rounded-none text-[10px] font-bold uppercase tracking-wider border-0 shadow-none data-[state=active]:bg-[#0078D4]/15 data-[state=active]:text-[#58A6FF] data-[state=active]:shadow-none data-[state=inactive]:text-[#484F58]"
        >
          Runner
        </TabsTrigger>
        <TabsTrigger
          value="permissions"
          className="h-full px-3 rounded-none text-[10px] font-bold uppercase tracking-wider border-0 shadow-none data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-400 data-[state=active]:shadow-none data-[state=inactive]:text-[#484F58]"
        >
          Perms
        </TabsTrigger>
        <TabsTrigger
          value="bugfix"
          className="h-full px-3 rounded-none text-[10px] font-bold uppercase tracking-wider border-0 shadow-none data-[state=active]:bg-red-500/15 data-[state=active]:text-red-400 data-[state=active]:shadow-none data-[state=inactive]:text-[#484F58]"
        >
          Fix Bug
        </TabsTrigger>
        <TabsTrigger
          value="explain"
          className="h-full px-3 rounded-none text-[10px] font-bold uppercase tracking-wider border-0 shadow-none data-[state=active]:bg-violet-500/15 data-[state=active]:text-violet-400 data-[state=active]:shadow-none data-[state=inactive]:text-[#484F58]"
        >
          Explain
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

// ─── Right Permissions Sidebar ────────────────────────────────────────────────

function PermissionsSidebarPanel({
  permissions,
  scriptId,
  moduleId,
  analyzeScriptId,
  packageId,
  token,
  onPermissionsChange,
  onModulePermissionsSaved,
}: {
  permissions: PsScriptPermissions | null;
  scriptId: string | null;
  moduleId?: string | null;
  analyzeScriptId?: string | null;
  packageId: string | null;
  token: string;
  onPermissionsChange: (p: PsScriptPermissions) => void;
  onModulePermissionsSaved?: (moduleId: string, perms: PsScriptPermissions) => void;
}) {
  const UUID_RE_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const { toast } = useToast();
  const [newScope, setNewScope] = useState("");
  const [newReason, setNewReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(permissions?.notes ?? "");
  const [editingReasonScope, setEditingReasonScope] = useState<string | null>(null);
  const [editingReasonValue, setEditingReasonValue] = useState("");
  const [inheritedPerms, setInheritedPerms] = useState<AppPermEntry[]>([]);
  const [inheritedLoading, setInheritedLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{ app: AppPermDetail[]; delegated: AppPermDetail[] } | null>(null);

  useEffect(() => {
    setNotesValue(permissions?.notes ?? "");
  }, [permissions?.notes]);

  // Clear stale AI analysis whenever the active script/module changes
  useEffect(() => {
    setAnalysisResult(null);
  }, [analyzeScriptId]);

  // Fetch inherited permissions when in package mode
  useEffect(() => {
    if (!(packageId && UUID_RE_LOCAL.test(packageId))) { setInheritedPerms([]); return; }
    setInheritedLoading(true);
    apiFetch(`/admin/ps-scripts/packages/${packageId}/inherited-permissions`, token, {})
      .then(r => r.json())
      .then((data: { permissions?: AppPermEntry[] }) => setInheritedPerms(data.permissions ?? []))
      .catch(() => setInheritedPerms([]))
      .finally(() => setInheritedLoading(false));
  }, [packageId, token]);

  const totalCount = permissions
    ? permissions.appPermissions.length + permissions.delegatedPermissions.length
    : 0;

  // editable when a persisted script, module, or package UUID is present
  const isScriptMode = !!(scriptId && UUID_RE_LOCAL.test(scriptId));
  const isModuleMode = !!(moduleId && UUID_RE_LOCAL.test(moduleId));
  const isPackageMode = !isScriptMode && !isModuleMode && !!(packageId && UUID_RE_LOCAL.test(packageId));
  const canEdit = isScriptMode || isModuleMode || isPackageMode;

  const savePermissions = async (permsToSave: PsScriptPermissions) => {
    setSaving(true);
    try {
      if (isScriptMode) {
        await apiFetch(`/admin/ps-scripts/${scriptId}`, token, {
          method: "PUT",
          body: JSON.stringify({ permissions: permsToSave }),
        });
      } else if (isModuleMode) {
        await apiFetch(`/admin/ps-scripts/modules/${moduleId}`, token, {
          method: "PUT",
          body: JSON.stringify({ permissions: permsToSave }),
        });
        onModulePermissionsSaved?.(moduleId!, permsToSave);
      } else if (isPackageMode) {
        await apiFetch(`/admin/ps-scripts/packages/${packageId}`, token, {
          method: "PATCH",
          body: JSON.stringify({ permissions: permsToSave }),
        });
      }
      toast({ title: "Permissions saved", description: "Changes applied immediately" });
    } catch (e) {
      toast({ title: "Failed to save permissions", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveApp = (scope: string) => {
    if (!permissions || !canEdit) return;
    const updated: PsScriptPermissions = { ...permissions, appPermissions: permissions.appPermissions.filter(p => p.scope !== scope) };
    onPermissionsChange(updated);
    void savePermissions(updated);
  };

  const handleRemoveDelegated = (scope: string) => {
    if (!permissions || !canEdit) return;
    const updated: PsScriptPermissions = { ...permissions, delegatedPermissions: permissions.delegatedPermissions.filter(p => p !== scope) };
    onPermissionsChange(updated);
    void savePermissions(updated);
  };

  const handleAddScope = () => {
    const scope = newScope.trim();
    if (!scope || !permissions || !canEdit) return;
    if (!permissions.appPermissions.find(p => p.scope === scope)) {
      const entry: AppPermEntry = { scope, reason: newReason.trim() };
      const updated: PsScriptPermissions = { ...permissions, appPermissions: [...permissions.appPermissions, entry] };
      onPermissionsChange(updated);
      void savePermissions(updated);
    }
    setNewScope("");
    setNewReason("");
  };

  const handleSaveReason = (scope: string) => {
    if (!permissions || !canEdit) return;
    const updated: PsScriptPermissions = {
      ...permissions,
      appPermissions: permissions.appPermissions.map(p => p.scope === scope ? { ...p, reason: editingReasonValue.trim() } : p),
    };
    onPermissionsChange(updated);
    void savePermissions(updated);
    setEditingReasonScope(null);
  };

  const handleSaveNotes = async () => {
    if (!permissions) return;
    const updated: PsScriptPermissions = { ...permissions, notes: notesValue };
    onPermissionsChange(updated);
    setEditingNotes(false);
    await savePermissions(updated);
  };

  const handleAnalyze = async () => {
    const targetId = analyzeScriptId ?? scriptId;
    if (!targetId || !UUID_RE_LOCAL.test(targetId)) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    try {
      // apiFetch already parses JSON and throws on non-2xx — use result directly
      const data = await apiFetch(`/admin/ps-scripts/${targetId}/analyze-permissions`, token, { method: "POST" }) as { appPermissionDetails?: AppPermDetail[]; delegatedPermissionDetails?: AppPermDetail[] } | null;
      setAnalysisResult({ app: data?.appPermissionDetails ?? [], delegated: data?.delegatedPermissionDetails ?? [] });
    } catch (e) {
      toast({ title: "Analysis failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveAnalysis = async () => {
    if (!permissions || !analysisResult) return;
    // Merge app perms: add new scopes or fill in missing reasons
    const existingByScope = new Map(permissions.appPermissions.map(p => [p.scope, p]));
    for (const detail of analysisResult.app) {
      const existing = existingByScope.get(detail.name);
      if (!existing) {
        existingByScope.set(detail.name, { scope: detail.name, reason: detail.description });
      } else if (!existing.reason) {
        existingByScope.set(detail.name, { ...existing, reason: detail.description });
      }
    }
    // Merge delegated perms: add new ones
    const delegatedSet = new Set(permissions.delegatedPermissions);
    for (const detail of analysisResult.delegated) {
      delegatedSet.add(detail.name);
    }
    const updated: PsScriptPermissions = {
      ...permissions,
      appPermissions: Array.from(existingByScope.values()),
      delegatedPermissions: Array.from(delegatedSet),
      appPermissionDetails: analysisResult.app,
      delegatedPermissionDetails: analysisResult.delegated,
    };
    onPermissionsChange(updated);
    await savePermissions(updated);
    setAnalysisResult(null);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0D1117]">
      <div className="px-4 py-2.5 border-b border-[#21262D] flex-shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
          <span className="text-[10px] font-semibold text-[#484F58] uppercase tracking-widest">Permissions</span>
          {(saving || analyzing) && <div className="w-3 h-3 border border-amber-400/50 border-t-amber-400 rounded-full animate-spin" />}
        </div>
        <div className="flex items-center gap-1.5">
          {totalCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">{totalCount}</span>
          )}
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !(analyzeScriptId ?? scriptId)}
            title={(analyzeScriptId ?? scriptId) ? "Analyze script with AI to identify required permissions" : "Save the script first"}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-violet-500/30 text-violet-400 bg-violet-500/10 hover:bg-violet-500/20"
          >
            {analyzing ? (
              <div className="w-2.5 h-2.5 border border-violet-400/50 border-t-violet-400 rounded-full animate-spin" />
            ) : (
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            )}
            Analyze
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* ── AI Analysis Results ── */}
        {analysisResult && (
          <div className="border border-violet-500/30 rounded bg-violet-500/5">
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-violet-500/20">
              <div className="flex items-center gap-1.5">
                <svg className="w-3 h-3 text-violet-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-wide">AI Analysis</span>
                <span className="text-[9px] text-violet-400/60">{analysisResult.app.length + analysisResult.delegated.length} permission{analysisResult.app.length + analysisResult.delegated.length !== 1 ? "s" : ""} found</span>
              </div>
              <button onClick={() => setAnalysisResult(null)} className="text-[#484F58] hover:text-[#7D8590] transition-colors rounded p-0.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-2 space-y-2">
              {analysisResult.app.length === 0 && analysisResult.delegated.length === 0 ? (
                <p className="text-[10px] text-[#7D8590] italic">No Azure App Registration permissions detected in this script.</p>
              ) : (
                <>
                  {analysisResult.app.length > 0 && (
                    <div>
                      <p className="text-[9px] font-semibold text-[#484F58] uppercase tracking-wide mb-1">Application</p>
                      <div className="flex flex-col gap-1.5">
                        {analysisResult.app.map(d => (
                          <div key={d.name} className="bg-[#0D1117] border border-violet-500/15 rounded px-2 py-1.5">
                            <code className="text-[11px] font-mono text-violet-300">{d.name}</code>
                            <p className="text-[10px] text-[#7D8590] mt-0.5 leading-relaxed">{d.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {analysisResult.delegated.length > 0 && (
                    <div>
                      <p className="text-[9px] font-semibold text-[#484F58] uppercase tracking-wide mb-1">Delegated</p>
                      <div className="flex flex-col gap-1.5">
                        {analysisResult.delegated.map(d => (
                          <div key={d.name} className="bg-[#0D1117] border border-violet-500/15 rounded px-2 py-1.5">
                            <code className="text-[11px] font-mono text-violet-300">{d.name}</code>
                            <p className="text-[10px] text-[#7D8590] mt-0.5 leading-relaxed">{d.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {isPackageMode && (
                    <p className="text-[9px] text-amber-400/70 leading-relaxed px-1">
                      ⚠ Saves to the entire package — all modules will share these permissions.
                    </p>
                  )}
                  <button
                    onClick={() => { void handleSaveAnalysis(); }}
                    disabled={saving}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-400 text-[10px] font-semibold rounded transition-colors disabled:opacity-50"
                  >
                    {saving ? (
                      <div className="w-3 h-3 border border-violet-400/40 border-t-violet-400 rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                    )}
                    {isPackageMode ? "Save to Package" : isModuleMode ? "Save to Module" : "Save to Script"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {!permissions ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
            <svg className="w-8 h-8 text-[#21262D] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
            <p className="text-[11px] text-[#484F58] leading-relaxed">Generate or load a script to see required permissions</p>
          </div>
        ) : (
          /* ── Script or Package mode: fully editable ── */
          <>
            {/* Inherited from associated scripts (read-only, package mode only) */}
            {isPackageMode && (inheritedLoading || inheritedPerms.length > 0) && (
              <div className="border border-[#21262D] rounded">
                <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[#21262D] bg-[#161B22]">
                  <svg className="w-3 h-3 text-[#484F58] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                  <span className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wide">Inherited from linked scripts</span>
                  {inheritedLoading && <div className="w-2.5 h-2.5 border border-[#484F58]/50 border-t-[#484F58] rounded-full animate-spin ml-auto" />}
                </div>
                {!inheritedLoading && inheritedPerms.length > 0 && (
                  <div className="p-2 space-y-1.5 bg-[#0D1117]">
                    <p className="text-[9px] text-[#484F58] leading-relaxed">Read-only — aggregated from standalone scripts associated to this package. Edit individual scripts to change their permissions.</p>
                    {inheritedPerms.map(p => (
                      <div key={p.scope} className="bg-[#161B22] border border-[#21262D] rounded px-2 py-1.5">
                        <code className="text-[11px] font-mono text-amber-400/80">{p.scope}</code>
                        {p.reason && <p className="text-[10px] text-[#7D8590] mt-0.5 leading-relaxed">{p.reason}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Module-level context banner */}
            {isModuleMode && (
              <div className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-[#161B22] border border-[#21262D] text-[10px] text-[#7D8590] leading-relaxed">
                <svg className="w-3 h-3 text-blue-400/70 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <span>Module-level permissions — unique to this module. Other modules in the package have their own independent permissions.</span>
              </div>
            )}
            {/* Package-level context banner */}
            {isPackageMode && (
              <div className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-[#161B22] border border-[#21262D] text-[10px] text-[#7D8590] leading-relaxed">
                <svg className="w-3 h-3 text-amber-400/70 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span>Package-level permissions — editable. Add/remove entries to keep the package-wide App Registration requirement in sync across all module scripts.</span>
              </div>
            )}
            {/* App permissions with per-entry reason editing */}
            <div>
              <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wide mb-1.5">Application</p>
              {permissions.appPermissions.length === 0 ? (
                <p className="text-[11px] text-[#484F58] italic">None</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {permissions.appPermissions.map((p) => (
                    <div key={p.scope} className="bg-[#161B22] border border-[#21262D] rounded p-2 group">
                      <div className="flex items-center gap-1">
                        <PermissionBadge text={p.scope} />
                        {canEdit && (
                          <button
                            onClick={() => handleRemoveApp(p.scope)}
                            className="ml-auto opacity-0 group-hover:opacity-100 text-[#484F58] hover:text-red-400 transition-all rounded p-0.5 flex-shrink-0"
                            title="Remove"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        )}
                      </div>
                      {editingReasonScope === p.scope ? (
                        <div className="mt-1.5 flex gap-1">
                          <input
                            autoFocus
                            value={editingReasonValue}
                            onChange={e => setEditingReasonValue(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSaveReason(p.scope); } if (e.key === "Escape") setEditingReasonScope(null); }}
                            placeholder="Why is this permission needed?"
                            className="flex-1 min-w-0 bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-[10px] text-[#C9D1D9] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
                          />
                          <button onClick={() => handleSaveReason(p.scope)} className="text-[10px] px-1.5 py-1 bg-[#0078D4]/20 border border-[#0078D4]/30 rounded text-[#58A6FF] hover:bg-[#0078D4]/30 flex-shrink-0">✓</button>
                          <button onClick={() => setEditingReasonScope(null)} className="text-[10px] px-1.5 py-1 bg-[#21262D] border border-[#30363D] rounded text-[#484F58] hover:text-[#C9D1D9] flex-shrink-0">✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingReasonScope(p.scope); setEditingReasonValue(p.reason); }}
                          className="mt-1 text-[10px] leading-relaxed text-left w-full"
                        >
                          {p.reason ? (
                            <span className="text-[#7D8590] hover:text-[#C9D1D9] transition-colors">{p.reason}</span>
                          ) : (
                            <span className="text-[#484F58] hover:text-[#7D8590] italic transition-colors">+ add reason…</span>
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Delegated permissions */}
            {permissions.delegatedPermissions.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wide mb-1.5">Delegated</p>
                <div className="flex flex-col gap-2">
                  {permissions.delegatedPermissions.map((p) => {
                    const detail = permissions.delegatedPermissionDetails?.find(d => d.name === p);
                    return (
                      <div key={p} className="bg-[#161B22] border border-[#21262D] rounded p-2 group">
                        <div className="flex items-center gap-1">
                          <PermissionBadge text={p} />
                          {canEdit && (
                            <button
                              onClick={() => handleRemoveDelegated(p)}
                              className="ml-auto opacity-0 group-hover:opacity-100 text-[#484F58] hover:text-red-400 transition-all rounded p-0.5 flex-shrink-0"
                              title="Remove"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          )}
                        </div>
                        {detail?.description && (
                          <p className="mt-1 text-[10px] text-[#7D8590] leading-relaxed">{detail.description}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="border-t border-[#21262D] pt-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wide">Notes</p>
                {canEdit && !editingNotes && (
                  <button onClick={() => setEditingNotes(true)} className="text-[10px] text-[#484F58] hover:text-[#0078D4] transition-colors">Edit</button>
                )}
              </div>
              {editingNotes ? (
                <div className="space-y-1">
                  <textarea
                    value={notesValue}
                    onChange={e => setNotesValue(e.target.value)}
                    rows={3}
                    className="w-full bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 text-[11px] text-[#C9D1D9] resize-none outline-none focus:border-[#0078D4]/60"
                    placeholder="Permission notes…"
                  />
                  <div className="flex gap-1">
                    <button onClick={handleSaveNotes} disabled={saving} className="text-[10px] px-2 py-1 bg-[#0078D4]/20 border border-[#0078D4]/30 rounded text-[#58A6FF] hover:bg-[#0078D4]/30 disabled:opacity-50">Save</button>
                    <button onClick={() => { setEditingNotes(false); setNotesValue(permissions.notes); }} className="text-[10px] px-2 py-1 bg-[#21262D] border border-[#30363D] rounded text-[#484F58] hover:text-[#C9D1D9]">Cancel</button>
                  </div>
                </div>
              ) : permissions.notes ? (
                <p className="text-[11px] text-[#7D8590] leading-relaxed">{permissions.notes}</p>
              ) : (
                <p className="text-[11px] text-[#484F58] italic">No notes</p>
              )}
            </div>

            {/* Add scope input (Application only) */}
            {canEdit && (
              <div className="border-t border-[#21262D] pt-2 space-y-1.5">
                <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wide">Add Application Scope</p>
                <input
                  value={newScope}
                  onChange={e => setNewScope(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddScope(); } }}
                  placeholder="e.g. User.Read.All"
                  className="w-full bg-[#161B22] border border-[#30363D] rounded px-2 py-1 text-[11px] text-[#C9D1D9] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
                />
                <input
                  value={newReason}
                  onChange={e => setNewReason(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddScope(); } }}
                  placeholder="Reason (why is this needed?)"
                  className="w-full bg-[#161B22] border border-[#30363D] rounded px-2 py-1 text-[11px] text-[#C9D1D9] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
                />
                <button
                  onClick={handleAddScope}
                  disabled={!newScope.trim()}
                  className="w-full py-1 bg-[#21262D] border border-[#30363D] rounded text-[10px] text-[#C9D1D9] hover:bg-[#30363D] disabled:opacity-40 transition-colors"
                >
                  Add & Save
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Bottom Panel ─────────────────────────────────────────────────────────────

type BottomTab = "prompt" | "instructions";

// ─── Generating Progress Dialog ───────────────────────────────────────────────

function GeneratingProgressDialog({
  open,
  pct = 0,
  phaseLabel = "Generating…",
}: {
  open: boolean;
  pct?: number;
  phaseLabel?: string;
}) {
  if (!open) return null;

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
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-[#E6EDF3] truncate mr-2">{phaseLabel}</span>
            <span className="text-[10px] text-[#7D8590] tabular-nums flex-shrink-0">{Math.round(pct)}%</span>
          </div>
          <div className="h-1.5 bg-[#21262D] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${pct}%`, background: "linear-gradient(90deg, #0078D4, #00B4D8)" }}
            />
          </div>
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
  onManualScriptGenerated,
}: {
  token: string;
  baseInstructions: string;
  detailedInstructions: string;
  onClose: () => void;
  onScriptGenerated: (title: string, script: string, permissions: PsScriptPermissions) => void;
  onPackageGenerated: (packageId: string, title: string, modules: ScriptModuleItem[], permissions: PsScriptPermissions) => void;
  onManualScriptGenerated: (detail: PsScriptDetail) => void;
}) {
  const { toast } = useToast();
  const { fetchWithAuth } = useAuth();
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
  const [genPct, setGenPct] = useState(5);
  const [genPhaseLabel, setGenPhaseLabel] = useState("Generating…");
  const [humanOnlyTasks, setHumanOnlyTasks] = useState<string[]>([]);
  const [humanOnlyExplanation, setHumanOnlyExplanation] = useState<string | null>(null);

  type ManualResult = {
    savedScript: PsScriptDetail;
    humanOnlyTasks: string[];
  };
  const [manualResult, setManualResult] = useState<ManualResult | null>(null);

  type TaskAssociation = {
    taskTitle: string;
    taskType: string;
    moduleFilename: string;
    associationStatus: "linked" | "stub";
    kanbanTasksUpdated: number;
  };
  type PackageResult = {
    packageId: string;
    title: string;
    modules: ScriptModuleItem[];
    permissions: PsScriptPermissions;
    taskAssociations: TaskAssociation[];
  };
  const [packageResult, setPackageResult] = useState<PackageResult | null>(null);
  const [pushDialogOpen, setPushDialogOpen] = useState(false);

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

  const handleDonePackage = () => {
    onClose();
  };

  const handleGenerate = async () => {
    if (!selectedServiceId) return;
    setGenerating(true);
    setGenPct(5);
    setGenPhaseLabel("Sending prompt to Claude…");
    setHumanOnlyExplanation(null);
    try {
      type GenResult = {
        type: "single" | "package" | "human-only" | "manual" | "saved";
        title: string;
        explanation?: string;
        script?: string;
        packageId?: string;
        modules?: ScriptModuleItem[];
        savedScript?: PsScriptDetail;
        humanOnlyTasks: string[];
        permissions?: PsScriptPermissions;
        taskAssociations?: TaskAssociation[];
      };
      const result = await consumeGenerationSSE<GenResult>(
        "/admin/ps-scripts/generate-from-service",
        fetchWithAuth,
        {
          serviceId: selectedServiceId,
          customInstructions: customInstructions.trim() || undefined,
          baseInstructions: baseInstructions.trim() || undefined,
          detailedInstructions: detailedInstructions.trim() || undefined,
        },
        (pct, label) => { setGenPct(pct); if (label) setGenPhaseLabel(label); },
      );

      console.log("[generate-from-service] result type:", result.type, "| packageId:", result.packageId ?? "—", "| modules:", result.modules?.length ?? "—", "| script len:", result.script?.length ?? "—");

      if (result.humanOnlyTasks?.length > 0) {
        setHumanOnlyTasks(result.humanOnlyTasks);
      }

      if (result.type === "human-only") {
        setHumanOnlyExplanation(result.explanation ?? "All tasks in this workflow require human action.");
        toast({ title: result.title ?? "No automation possible", description: "See details below." });
      } else if (result.type === "package" && result.packageId && result.modules) {
        const pkgPerms: PsScriptPermissions = result.permissions ?? { appPermissions: [], delegatedPermissions: [], notes: "" };
        setPackageResult({ packageId: result.packageId, title: result.title, modules: result.modules, permissions: pkgPerms, taskAssociations: result.taskAssociations ?? [] });
        // Refresh the library sidebar immediately so the package appears regardless of how the dialog is dismissed
        onPackageGenerated(result.packageId, result.title, result.modules, pkgPerms);
      } else if (result.type === "saved" && result.savedScript) {
        // Auto-saved single script — add to library and auto-close (no misleading "manual" panel)
        onManualScriptGenerated(result.savedScript);
        toast({ title: "Script saved to library", description: result.savedScript.title });
        onClose();
      } else if (result.type === "manual" && result.savedScript) {
        onManualScriptGenerated(result.savedScript);
        setManualResult({ savedScript: result.savedScript, humanOnlyTasks: result.humanOnlyTasks ?? [] });
      } else if (result.type === "single" && result.script) {
        const perms = result.permissions ?? { appPermissions: [], delegatedPermissions: [], notes: "" };
        onScriptGenerated(result.title, result.script, perms);
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

          {/* Manual script result panel — shown when workflow has USER_ACCOUNT_REQUIRED tasks */}
          {manualResult && !packageResult && (
            <div className="space-y-3">
              <div className="bg-[#0D1117] border border-amber-800/50 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[#21262D] bg-amber-900/15">
                  <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  <p className="text-[11px] font-semibold text-amber-400 flex-1">Manual script saved — requires interactive execution</p>
                </div>
                <div className="px-3 py-2.5 space-y-1.5">
                  <p className="text-[11px] font-medium text-[#E6EDF3]">{manualResult.savedScript.title}</p>
                  <p className="text-[10px] text-[#7D8590] leading-relaxed">
                    One or more workflow tasks require a licensed user account (interactive auth). A consolidated script was generated and saved to your{" "}
                    <span className="text-amber-400 font-medium">Scripts library</span> — look for the{" "}
                    <span className="font-mono text-amber-400 bg-amber-500/20 px-1 rounded text-[9px]">M</span>{" "}
                    badge in the sidebar.
                  </p>
                </div>
              </div>
              {manualResult.humanOnlyTasks.length > 0 && (
                <div className="bg-[#0D1117] border border-[#21262D] rounded-lg overflow-hidden">
                  <div className="px-3 py-2 border-b border-[#21262D]">
                    <p className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide">Human-only tasks (not scripted)</p>
                  </div>
                  <div className="divide-y divide-[#21262D]">
                    {manualResult.humanOnlyTasks.map((task, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#484F58] mt-1.5 flex-shrink-0" />
                        <span className="text-[11px] text-[#7D8590]">{task}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Package result panel — shown after successful package generation */}
          {packageResult && (
            <div className="space-y-3">
              {/* Module list */}
              <div className="bg-[#0D1117] border border-[#0078D4]/40 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[#21262D] bg-[#0078D4]/10">
                  <svg className="w-3.5 h-3.5 text-[#58A6FF] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M10 12v4m4-4v4" /></svg>
                  <p className="text-[11px] font-semibold text-[#58A6FF] flex-1">Package generated — {packageResult.modules.length} module{packageResult.modules.length !== 1 ? "s" : ""}</p>
                  <span className="text-[10px] text-[#7D8590] truncate max-w-[180px]">{packageResult.title}</span>
                </div>
                <div className="divide-y divide-[#21262D]">
                  {packageResult.modules.map((m) => (
                    <div key={m.filename} className="flex items-center gap-2.5 px-3 py-2">
                      <div className="w-3.5 h-3.5 rounded-full border border-[#30363D] flex-shrink-0" />
                      <span className="text-[11px] font-mono text-[#E6EDF3] flex-1">{m.filename}</span>
                      {m.description && <span className="text-[10px] text-[#7D8590] truncate max-w-[200px]">{m.description}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Task → module association summary */}
              {packageResult.taskAssociations.length > 0 && (
                <div className="bg-[#0D1117] border border-[#21262D] rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[#21262D]">
                    <svg className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                    <p className="text-[11px] font-semibold text-teal-400">Kanban task associations</p>
                  </div>
                  <div className="divide-y divide-[#21262D]">
                    {packageResult.taskAssociations.map((assoc, i) => (
                      <div key={i} className="px-3 py-2 flex items-start gap-2.5">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${assoc.associationStatus === "linked" ? "bg-teal-400" : "bg-amber-400"}`} />
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <p className="text-[11px] font-medium text-[#E6EDF3] truncate">{assoc.taskTitle}</p>
                          <p className="text-[10px] font-mono text-[#7D8590] truncate">→ {assoc.moduleFilename}</p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                            assoc.taskType === "manualScript"
                              ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                              : "bg-violet-500/15 text-violet-400 border border-violet-500/30"
                          }`}>
                            {assoc.taskType === "manualScript" ? "manual" : "auto"}
                          </span>
                          {assoc.associationStatus === "stub" && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30">stub</span>
                          )}
                          {assoc.kanbanTasksUpdated > 0 ? (
                            <span className="text-[9px] text-teal-400">{assoc.kanbanTasksUpdated} card{assoc.kanbanTasksUpdated !== 1 ? "s" : ""} linked</span>
                          ) : (
                            <span className="text-[9px] text-[#484F58]">no cards yet</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
              : manualResult
              ? "Script saved to your Scripts library. Open in editor or close to continue."
              : "AI classifies M365/Azure-automatable tasks and generates production-ready scripts. Human-only tasks are listed but not automated."}
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            {packageResult ? (
              <>
                <button
                  onClick={handleDonePackage}
                  className="px-3 py-1.5 text-xs text-[#7D8590] hover:text-[#E6EDF3] rounded border border-[#30363D] hover:bg-[#21262D] transition-colors"
                >
                  Done
                </button>
                <button
                  onClick={() => setPushDialogOpen(true)}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#0078D4]/20 border border-[#0078D4]/40 text-[#58A6FF] hover:bg-[#0078D4]/30 rounded transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  Push to Azure
                </button>
              </>
            ) : manualResult ? (
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-[#7D8590] hover:text-[#E6EDF3] rounded border border-[#30363D] hover:bg-[#21262D] transition-colors"
              >
                Done
              </button>
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
      <GeneratingProgressDialog open={generating} pct={genPct} phaseLabel={genPhaseLabel} />
      {packageResult && (
        <PackagePushProgressDialog
          open={pushDialogOpen}
          packageId={packageResult.packageId}
          modules={packageResult.modules}
          token={token}
          onClose={() => setPushDialogOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Summary Error Banner ─────────────────────────────────────────────────────

function SummaryErrorBanner({
  kind,
  aiResponse,
  onRetry,
  onDismiss,
}: {
  kind: "generate" | "fix";
  aiResponse: string | null;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl overflow-hidden">
      <div className="flex items-start gap-3 px-3 py-2.5">
        <svg className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-400 mb-0.5">AI returned a summary instead of a script</p>
          <p className="text-[11px] text-amber-300/70">
            {kind === "generate"
              ? "The model described the script instead of writing it. Your editor is unchanged."
              : "The model described the fix. Your original script has not been modified."}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {aiResponse && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[10px] font-medium px-2 py-1 rounded border border-amber-500/30 text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
              title="View what the AI said"
            >
              {expanded ? "Hide" : "View response"}
            </button>
          )}
          <button onClick={onRetry} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-colors">Retry</button>
          <button onClick={onDismiss} className="p-1 text-amber-400/50 hover:text-amber-400 rounded transition-colors"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
      </div>
      {expanded && aiResponse && (
        <div className="border-t border-amber-500/20 px-3 py-2.5 bg-amber-500/5">
          <p className="text-[10px] font-semibold text-amber-400/60 uppercase tracking-wide mb-1.5">AI response</p>
          <pre className="text-[10px] text-amber-300/60 font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">{aiResponse}</pre>
        </div>
      )}
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
  generating,
  summaryError,
  summaryAiResponse,
  onGenerate,
  onDismissSummaryError,
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
  generating: boolean;
  summaryError: "generate" | "fix" | null;
  summaryAiResponse: string | null;
  onGenerate: () => void;
  onDismissSummaryError: () => void;
  activeTab: BottomTab;
  onActiveTabChange: (t: BottomTab) => void;
  onOpenGenerateFromService: () => void;
}) {
  const setActiveTab = onActiveTabChange;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0D1117] border-t border-[#21262D]">
      {/* Tab strip */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#21262D] flex-shrink-0 bg-[#161B22]">
        {(["prompt", "instructions"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${activeTab === t ? "bg-[#0078D4]/15 text-[#58A6FF] border border-[#0078D4]/25" : "text-[#7D8590] hover:text-[#E6EDF3] border border-transparent"}`}
          >
            {t === "prompt" ? "Prompt" : "Custom Instructions"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Summary-error retry banner — only shown for generate errors */}
        {summaryError === "generate" && (
          <SummaryErrorBanner
            kind="generate"
            aiResponse={summaryAiResponse}
            onRetry={onGenerate}
            onDismiss={onDismissSummaryError}
          />
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
  const { accessToken, fetchWithAuth } = useAuth();
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
  const [genPct, setGenPct] = useState(5);
  const [genPhaseLabel, setGenPhaseLabel] = useState("Generating…");
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
  const [explainText, setExplainText] = useState("");
  const [explaining, setExplaining] = useState(false);
  const [summaryAiResponse, setSummaryAiResponse] = useState<string | null>(null);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [modulePushOpen, setModulePushOpen] = useState(false);
  const [modules, setModules] = useState<ScriptModuleItem[]>([]);
  const [editorScript, setEditorScript] = useState<PsScriptDetail | null>(null);
  const [generateFromServiceOpen, setGenerateFromServiceOpen] = useState(false);

  // ── Library state ───────────────────────────────────────────────────────────
  const [scripts, setScripts] = useState<PsScriptListItem[]>([]);
  const [packages, setPackages] = useState<ScriptPackageListItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [newScriptSetDialogOpen, setNewScriptSetDialogOpen] = useState(false);
  const [loadingScriptId, setLoadingScriptId] = useState<string | null>(null);
  const [openDrawerScriptId, setOpenDrawerScriptId] = useState<string | null>(null);
  const [openDrawerPackage, setOpenDrawerPackage] = useState<ScriptPackageListItem | null>(null);
  const [loadedPackageTitle, setLoadedPackageTitle] = useState<string | null>(null);
  const [loadedPackage, setLoadedPackage] = useState<ScriptPackageListItem | null>(null);
  const [activePackageTitle, setActivePackageTitle] = useState<string | null>(null);

  // ── Run result detail state ──────────────────────────────────────────────────
  const [selectedResult, setSelectedResult] = useState<RunResult | null>(null);

  // ── Syntax validation state (for push-to-Azure pre-flight) ───────────────────
  const [pushValidating,   setPushValidating]   = useState(false);
  const [pushSyntaxErrors, setPushSyntaxErrors] = useState<Array<{ line: number; column: number; message: string }>>([]);

  // ── Link existing runbook state ───────────────────────────────────────────────
  const [linkRunbookOpen, setLinkRunbookOpen] = useState(false);
  const [linkRunbookValue, setLinkRunbookValue] = useState("");
  const [linkRunbookSaving, setLinkRunbookSaving] = useState(false);

  // ── Confirm dialog state ─────────────────────────────────────────────────────
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: "", description: "", onConfirm: () => {} });

  const showConfirm = useCallback((title: string, description: string, onConfirm: () => void) => {
    setConfirmState({ open: true, title, description, onConfirm });
  }, []);

  // ── IDE panel layout state ───────────────────────────────────────────────────
  const leftPanel = useResize(IDE_LEFT_WIDTH_KEY, 240, 140, 400);
  const rightPanel = useResize(IDE_RIGHT_WIDTH_KEY, 260, 160, 420);
  const bottomPanel = useResize(IDE_BOTTOM_HEIGHT_KEY, 220, 100, 450);

  const [leftCollapsed, setLeftCollapsed] = useState(() => lsGet(IDE_LEFT_COLLAPSED_KEY, "false") === "true");
  const [rightVisible, setRightVisible] = useState(() => lsGet(IDE_RIGHT_VISIBLE_KEY, "true") === "true");
  const [leftMode, setLeftMode] = useState<"library" | "results">(() => {
    const stored = lsGet(IDE_LEFT_MODE_KEY, "library");
    // Guard against stale values (e.g. "catalog") from before the catalog was removed
    if (stored !== "library" && stored !== "results") { lsSet(IDE_LEFT_MODE_KEY, "library"); return "library"; }
    return (stored === "results" ? "results" : "library") as "library" | "results";
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rightActiveTab, setRightActiveTab] = useState<"runner" | "permissions" | "bugfix" | "explain">(() =>
    (lsGet(IDE_RIGHT_TAB_KEY, "runner") as "runner" | "permissions" | "bugfix" | "explain")
  );
  const [runLibraryScriptTarget, setRunLibraryScriptTarget] = useState<PsScriptListItem | null>(null);
  const [runLibraryModuleTarget, setRunLibraryModuleTarget] = useState<ScriptModuleItem | null>(null);

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


  // ── Persist prompt fields ─────────────────────────────────────────────────────
  const handleCategoryChange = (v: string) => { setCategory(v); lsSet(CATEGORY_KEY, v); };
  const handlePromptChange = (v: string) => { setPrompt(v); lsSet(PROMPT_KEY, v); };
  const handleDetailedInstructionsChange = (v: string) => { setDetailedInstructions(v); lsSet(DETAILED_INSTRUCTIONS_KEY, v); };
  const handleBaseInstructionsChange = (v: string) => { setBaseInstructions(v); lsSet(BASE_INSTRUCTIONS_KEY, v); };

  // ── API actions ───────────────────────────────────────────────────────────────
  const generate = async () => {
    if (!prompt.trim()) { toast({ title: "Enter a description first", variant: "destructive" }); return; }
    setGenerating(true);
    setGenPct(5);
    setGenPhaseLabel("Sending prompt to Claude…");
    setModules([]);
    setLoadedPackage(null);
    setLoadedPackageTitle(null);
    setFixSummary("");
    setSummaryError(null);
    try {
      const result = await consumeGenerationSSE<{ script: string; permissions: PsScriptPermissions }>(
        "/admin/ps-scripts/generate",
        fetchWithAuth,
        { prompt: prompt.trim(), category, baseInstructions: baseInstructions.trim() || undefined, detailedInstructions: detailedInstructions.trim() || undefined },
        (pct, label) => { setGenPct(pct); if (label) setGenPhaseLabel(label); },
      );
      if (!result.script || result.script.trim().length < 20) {
        toast({ title: "Generation could not be applied", description: "The AI returned an unreadable response.", variant: "destructive" });
        return;
      }
      setScriptBody(result.script);
      cleanBodyRef.current = result.script;
      setPermissions(result.permissions);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      if (msg.toLowerCase().includes("summary instead of a script")) {
        setSummaryError("generate");
        setSummaryAiResponse(e instanceof ApiError ? (e.aiResponse ?? null) : null);
      } else toast({ title: "Generation failed", description: msg, variant: "destructive" });
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
      if (msg.toLowerCase().includes("summary instead of a script")) {
        setSummaryError("fix");
        setSummaryAiResponse(e instanceof ApiError ? (e.aiResponse ?? null) : null);
      } else toast({ title: "Fix failed", description: msg, variant: "destructive" });
    } finally {
      setFixing(false);
    }
  };

  const explainScript = async () => {
    if (!scriptBody.trim()) return;
    setExplaining(true);
    setExplainText("");
    try {
      const result = await apiFetch("/admin/ps-scripts/explain", token, {
        method: "POST",
        body: JSON.stringify({ scriptContent: scriptBody }),
      }) as { explanation: string };
      setExplainText(result.explanation);
    } catch (e) {
      toast({ title: "Explain failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setExplaining(false);
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
      setLoadedPackage(pkg);
      setLoadedPackageTitle(result.title);
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

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const updateSavedCopy = async () => {
    if (!editorScript?.id || !scriptBody) return;
    setUpdating(true);
    try {
      if (editingModuleId) {
        // Editing a module that belongs to a package — use the modules endpoint
        await apiFetch(`/admin/ps-scripts/modules/${editingModuleId}`, token, {
          method: "PUT",
          body: JSON.stringify({ content: scriptBody }),
        });
        cleanBodyRef.current = scriptBody;
        // Reflect the change in the packages list so the sidebar stays fresh
        setPackages((prev) => prev.map((pkg) => ({
          ...pkg,
          modules: pkg.modules.map((m) => m.id === editingModuleId ? { ...m, content: scriptBody } : m),
        })));
        toast({ title: "Module updated" });
      } else if (!UUID_RE.test(editorScript.id)) {
        // Synthetic id (e.g. mod-<filename>) — module has no DB record yet; cannot update
        toast({ title: "Cannot update", description: "This module was not saved to the library. Please re-generate the package.", variant: "destructive" });
      } else {
        // Editing a standalone library script
        const updated = await apiFetch(`/admin/ps-scripts/${editorScript.id}`, token, {
          method: "PUT",
          body: JSON.stringify({ scriptBody, permissions }),
        }) as PsScriptListItem;
        cleanBodyRef.current = scriptBody;
        setScripts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        toast({ title: "Library entry updated" });
      }
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  };

  const linkExistingRunbook = async () => {
    if (!editorScript?.id || !linkRunbookValue.trim()) return;
    setLinkRunbookSaving(true);
    try {
      const updated = await apiFetch(`/admin/ps-scripts/${editorScript.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ azureRunbookName: linkRunbookValue.trim() }),
      }) as PsScriptDetail;
      setEditorScript(prev => prev ? { ...prev, azureRunbookName: updated.azureRunbookName } : prev);
      setScripts(prev => prev.map(s => s.id === updated.id ? { ...s, azureRunbookName: updated.azureRunbookName } : s));
      setLinkRunbookOpen(false);
      setLinkRunbookValue("");
      toast({ title: "Runbook linked", description: `Script is now linked to "${updated.azureRunbookName}" in Azure Automation.` });
    } catch (e) {
      toast({ title: "Failed to link runbook", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setLinkRunbookSaving(false);
    }
  };

  const pushToAzure = async () => {
    if (!editorScript?.id || !scriptBody) return;

    // Pre-flight: validate PowerShell syntax before pushing to Azure
    if (scriptBody.trim()) {
      setPushSyntaxErrors([]);
      setPushValidating(true);
      try {
        const valData = await apiFetch("/admin/scripts/validate-syntax", token, {
          method: "POST",
          body: JSON.stringify({ content: scriptBody }),
        }) as { valid: boolean; skipped?: boolean; errors?: Array<{ line: number; column: number; message: string }> } | null;
        if (valData && !valData.valid && valData.errors && valData.errors.length > 0) {
          setPushSyntaxErrors(valData.errors);
          setPushValidating(false);
          return;
        }
      } catch {
        // validation request failed — proceed anyway
      } finally {
        setPushValidating(false);
      }
    }

    // Save first — silently; abort the push if save fails
    setUpdating(true);
    try {
      if (editingModuleId) {
        await apiFetch(`/admin/ps-scripts/modules/${editingModuleId}`, token, {
          method: "PUT",
          body: JSON.stringify({ content: scriptBody }),
        });
        cleanBodyRef.current = scriptBody;
        setPackages((prev) => prev.map((pkg) => ({
          ...pkg,
          modules: pkg.modules.map((m) => m.id === editingModuleId ? { ...m, content: scriptBody } : m),
        })));
      } else if (!UUID_RE.test(editorScript.id)) {
        throw new Error("This module has no DB record and cannot be saved before pushing.");
      } else {
        const updated = await apiFetch(`/admin/ps-scripts/${editorScript.id}`, token, {
          method: "PUT",
          body: JSON.stringify({ scriptBody, permissions }),
        }) as PsScriptListItem;
        cleanBodyRef.current = scriptBody;
        setScripts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      }
    } catch (e) {
      toast({ title: "Save failed — Azure push aborted", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
      setUpdating(false);
      return;
    }
    setUpdating(false);

    // Module from a package — use the package push dialog for this single module
    if (editingModuleId && editingPackageId) {
      setModulePushOpen(true);
      return;
    }

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
  const handleSidebarScriptClick = (id: string) => {
    const isDirty = scriptBody.length > 0 && scriptBody !== cleanBodyRef.current;
    const doLoad = async () => {
      setLoadingScriptId(id);
      try {
        const detail = await apiFetch(`/admin/ps-scripts/${id}`, token) as PsScriptDetail;
        setEditorScript(detail);
        setEditingModuleId(null);
        setEditingPackageId(null);
        setScriptBody(detail.scriptBody);
        cleanBodyRef.current = detail.scriptBody;
        setPermissions(detail.permissions);
        setModules([]);
        setLoadedPackage(null);
        setLoadedPackageTitle(null);
        setActivePackageTitle(null);
        setFixSummary("");
        setSummaryError(null);
      } catch {
        toast({ title: "Failed to load script", variant: "destructive" });
      } finally {
        setLoadingScriptId(null);
      }
    };
    if (isDirty) {
      showConfirm(
        "Discard unsaved changes?",
        "You have unsaved changes. Switch script and discard them?",
        () => void doLoad(),
      );
      return;
    }
    void doLoad();
  };

  const handleSidebarModuleClick = (module: ScriptModuleItem, pkg: ScriptPackageListItem) => {
    const isDirty = scriptBody.length > 0 && scriptBody !== cleanBodyRef.current;
    const doSwitch = () => {
      const modulePerms: PsScriptPermissions = module.permissions ?? { appPermissions: [], delegatedPermissions: [], notes: "" };
      const syntheticScript: PsScriptDetail = {
        id: module.id ?? `mod-${module.filename}`,
        title: module.filename,
        description: module.description,
        category: pkg.category,
        tags: pkg.tags,
        azureRunbookName: null,
        azureSyncedAt: null,
        createdAt: pkg.createdAt,
        updatedAt: pkg.createdAt,
        scriptBody: module.content,
        permissions: modulePerms,
      };
      setEditorScript(syntheticScript);
      setEditingModuleId(module.id ?? null);
      setEditingPackageId(pkg.id);
      setScriptBody(module.content);
      cleanBodyRef.current = module.content;
      setPermissions(modulePerms);
      setModules([]);
      setLoadedPackage(null);
      setLoadedPackageTitle(null);
      setActivePackageTitle(pkg.title);
      setFixSummary("");
      setSummaryError(null);
    };
    if (isDirty) {
      showConfirm(
        "Discard unsaved changes?",
        "You have unsaved changes. Switch module and discard them?",
        doSwitch,
      );
      return;
    }
    doSwitch();
  };

  const handleScriptSaved = (s: PsScriptListItem) => {
    setScripts((prev) => [s, ...prev]);
    setLibraryLoaded(true);
    setShowSaveModal(false);
    toast({ title: "Script saved to library" });
  };

  const handleDeleteScript = (id: string) => {
    showConfirm("Delete script?", "Delete this script? This cannot be undone.", async () => {
      try {
        await apiFetch(`/admin/ps-scripts/${id}`, token, { method: "DELETE" });
        setScripts((prev) => prev.filter((s) => s.id !== id));
        if (editorScript?.id === id) { setEditorScript(null); setEditingModuleId(null); setEditingPackageId(null); }
        toast({ title: "Script deleted" });
      } catch {
        toast({ title: "Failed to delete script", variant: "destructive" });
      }
    });
  };

  const handleDeletePackage = (id: string) => {
    setPackages((prev) => prev.filter((p) => p.id !== id));
    if (openDrawerPackage?.id === id) setOpenDrawerPackage(null);
    if (loadedPackage?.id === id) {
      setLoadedPackage(null);
      setLoadedPackageTitle(null);
      setModules([]);
    }
    toast({ title: "Package deleted" });
  };

  const handleSidebarPackageClick = (pkg: ScriptPackageListItem) => {
    setOpenDrawerPackage(null);
    setModules(pkg.modules);
    setLoadedPackageTitle(pkg.title);
    setLoadedPackage(pkg);
    setEditorScript(null);
    setEditingModuleId(null);
    setEditingPackageId(null);
    setActivePackageTitle(null);
    setSelectedResult(null);
  };

  const handleCenterPaneDeletePackage = () => {
    if (!loadedPackage) return;
    const pkg = loadedPackage;
    showConfirm(
      "Delete package?",
      `Delete package "${pkg.title}" and all its modules? This cannot be undone.`,
      async () => {
        try {
          await apiFetch(`/admin/ps-scripts/packages/${pkg.id}`, token, { method: "DELETE" });
          handleDeletePackage(pkg.id);
        } catch {
          toast({ title: "Failed to delete package", variant: "destructive" });
        }
      },
    );
  };

  const handleLoadInEditor = (script: PsScriptDetail) => {
    setEditorScript(script);
    setEditingModuleId(null);
    setEditingPackageId(null);
    setScriptBody(script.scriptBody);
    cleanBodyRef.current = script.scriptBody;
    setPermissions(script.permissions);
    setModules([]);
    setFixSummary("");
    setSummaryError(null);
    setOpenDrawerScriptId(null);
    setSelectedResult(null);
    setLeftMode("library");
    lsSet(IDE_LEFT_MODE_KEY, "library");
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

      {/* ── Top action bar ────────────────────────────────────────────────── */}
      {/* flex-shrink-0 keeps the bar fixed-height in the flex column so the IDE body
          below always fills the remaining space. overflow-x-auto prevents the bar from
          growing taller (and clipping the IDE) when many buttons are visible on a
          narrow viewport — buttons scroll horizontally instead of wrapping. */}
      <div className="flex-shrink-0 flex flex-nowrap items-center gap-1.5 px-4 bg-[#161B22] border-b border-[#21262D] min-h-[42px] overflow-x-auto">
        {scriptBody ? (
          <>
            <button onClick={handleCopy} title="Copy to clipboard" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">
              {copied ? <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
              {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={handleDownload} title="Download .ps1 file" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-[#30363D] text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#21262D] transition-colors">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              .ps1
            </button>
            <button
              onClick={() => { setRightActiveTab("bugfix"); setRightVisible(true); lsSet(IDE_RIGHT_VISIBLE_KEY, "true"); lsSet(IDE_RIGHT_TAB_KEY, "bugfix"); }}
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
              <button onClick={pushToAzure} disabled={azurePushDialog.open || modulePushOpen || pushValidating} title="Push to Azure Automation" className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-[#0078D4]/30 bg-[#0078D4]/10 text-[#58A6FF] hover:bg-[#0078D4]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {pushValidating ? (
                  <div className="w-3 h-3 border border-[#58A6FF]/40 border-t-[#58A6FF] rounded-full animate-spin" />
                ) : (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                )}
                {pushValidating ? "Validating…" : "Azure"}
              </button>
            )}
            {editorScript?.id && !editingModuleId && (
              linkRunbookOpen ? (
                <span className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={linkRunbookValue}
                    onChange={e => setLinkRunbookValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") void linkExistingRunbook(); if (e.key === "Escape") { setLinkRunbookOpen(false); setLinkRunbookValue(""); } }}
                    placeholder={editorScript.azureRunbookName ?? "runbook-name-in-azure"}
                    className="text-[11px] px-2 py-1 rounded border border-[#30363D] bg-[#0D1117] text-[#E6EDF3] placeholder-[#484F58] focus:outline-none focus:border-[#0078D4] w-48"
                  />
                  <button onClick={() => void linkExistingRunbook()} disabled={linkRunbookSaving || !linkRunbookValue.trim()} className="text-[11px] px-2 py-1 rounded bg-[#0078D4]/20 border border-[#0078D4]/40 text-[#58A6FF] hover:bg-[#0078D4]/30 disabled:opacity-50 transition-colors">
                    {linkRunbookSaving ? "…" : "Link"}
                  </button>
                  <button onClick={() => { setLinkRunbookOpen(false); setLinkRunbookValue(""); }} className="text-[11px] px-1 py-1 text-[#484F58] hover:text-[#8B949E]">✕</button>
                </span>
              ) : (
                <button
                  onClick={() => { setLinkRunbookOpen(true); setLinkRunbookValue(editorScript.azureRunbookName ?? ""); }}
                  title={editorScript.azureRunbookName ? `Linked: ${editorScript.azureRunbookName} — click to change` : "Link an existing Azure runbook name to this script"}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-[#30363D] bg-transparent text-[#484F58] hover:text-[#8B949E] hover:border-[#484F58] transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                  {editorScript.azureRunbookName ? editorScript.azureRunbookName : "Link runbook"}
                </button>
              )
            )}
            <button onClick={() => setShowSaveModal(true)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-[#0078D4]/15 border border-[#0078D4]/30 text-[#58A6FF] hover:bg-[#0078D4]/25 transition-colors">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
              Save
            </button>
          </>
        ) : (
          <span className="text-[11px] text-[#484F58] select-none">Generate or open a script to see actions</span>
        )}
      </div>

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
                {leftMode === "library" ? "LIBRARY" : "RESULTS"}
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
                {(["library", "results"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => { setLeftMode(m); lsSet(IDE_LEFT_MODE_KEY, m); }}
                    className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-colors text-center border-b-2 ${
                      leftMode === m
                        ? "text-[#58A6FF] border-[#0078D4]"
                        : "text-[#484F58] hover:text-[#E6EDF3] border-transparent"
                    }`}
                  >
                    {m === "library" ? "Library" : "Results"}
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
                    onOpenModule={handleSidebarModuleClick}
                    loadingScriptId={loadingScriptId}
                    onRunScript={setRunLibraryScriptTarget}
                    onRunModule={setRunLibraryModuleTarget}
                    token={token}
                    onDeleteScript={(id) => setScripts(prev => prev.filter(s => s.id !== id))}
                    onModuleRemoved={(moduleId, packageId) =>
                      setPackages(prev => prev.map(pkg =>
                        pkg.id === packageId
                          ? { ...pkg, modules: pkg.modules.filter(m => m.id !== moduleId) }
                          : pkg
                      ))
                    }
                    onNewSet={() => setNewScriptSetDialogOpen(true)}
                  />
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
                {editorScript?.tags?.includes("manual") && (
                  <span className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 uppercase tracking-wide" title="Must be run locally under a licensed user account — cannot run as a service principal">Manual</span>
                )}
                {isUnsaved && <span className="w-1.5 h-1.5 rounded-full bg-[#E6EDF3]/50 flex-shrink-0" title="Unsaved changes" />}
                {editorScript && (
                  <button
                    onClick={() => { setEditorScript(null); setEditingModuleId(null); setEditingPackageId(null); setScriptBody(""); cleanBodyRef.current = ""; setPermissions({ appPermissions: [], delegatedPermissions: [], notes: "" }); setModules([]); setLoadedPackage(null); setLoadedPackageTitle(null); }}
                    title="Clear — start a new script"
                    className="p-0.5 text-[#484F58] hover:text-[#E6EDF3] rounded transition-colors flex-shrink-0"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>

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

            {/* Push-to-Azure syntax error alert */}
            {pushSyntaxErrors.length > 0 && (
              <div className="px-3 py-2 border-b border-[#21262D]">
                <SyntaxErrorAlert errors={pushSyntaxErrors} onDismiss={() => setPushSyntaxErrors([])} />
              </div>
            )}

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
                token={token}
                onBack={() => { setModules([]); setLoadedPackageTitle(null); setLoadedPackage(null); }}
                loadedPkg={loadedPackage}
                onEdit={loadedPackage ? () => setOpenDrawerPackage(loadedPackage) : undefined}
                onDelete={loadedPackage ? handleCenterPaneDeletePackage : undefined}
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
                generating={generating}
                summaryError={summaryError}
                summaryAiResponse={summaryAiResponse}
                onGenerate={generate}
                onDismissSummaryError={() => { setSummaryError(null); setSummaryAiResponse(null); }}
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
              editingModuleId={editingModuleId}
              editingPackageId={editingPackageId}
              token={token}
              onPermissionsChange={setPermissions}
              onModulePermissionsSaved={(modId, perms) => {
                setPackages(prev => prev.map(pkg => ({
                  ...pkg,
                  modules: pkg.modules.map(m => m.id === modId ? { ...m, permissions: perms } : m),
                })));
              }}
              activeTab={rightActiveTab}
              onActiveTabChange={(t) => { setRightActiveTab(t); lsSet(IDE_RIGHT_TAB_KEY, t); }}
              bugDescription={bugDescription}
              onBugDescriptionChange={setBugDescription}
              fixing={fixing}
              fixSummary={fixSummary}
              onFixBug={fixBug}
              summaryError={summaryError}
              summaryAiResponse={summaryAiResponse}
              onDismissSummaryError={() => { setSummaryError(null); setSummaryAiResponse(null); }}
              onDismissFixSummary={() => setFixSummary("")}
              explaining={explaining}
              explainText={explainText}
              onExplain={() => { explainScript(); }}
              onDismissExplain={() => setExplainText("")}
            />
          </div>
        )}
      </div>

      {/* ── Modals & Drawers ──────────────────────────────────────────────── */}
      <GeneratingProgressDialog open={generating} pct={genPct} phaseLabel={genPhaseLabel} />

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
            setEditingModuleId(null);
            setEditingPackageId(null);
            setModules([]);
            setLoadedPackage(null);
            setLoadedPackageTitle(null);
            setFixSummary("");
            setSummaryError(null);
            setSelectedResult(null);
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
            setLoadedPackage(pkg);
            setLoadedPackageTitle(title);
            setPermissions(perms);
            setEditorScript(null);
            setEditingModuleId(null);
            setEditingPackageId(null);
            setFixSummary("");
            setSummaryError(null);
            setSelectedResult(null);
            setLeftMode("library");
            lsSet(IDE_LEFT_MODE_KEY, "library");
            toast({ title: "Package generated", description: title });
          }}
          onManualScriptGenerated={(detail) => {
            setScripts((prev) => [detail, ...prev.filter((s) => s.id !== detail.id)]);
            handleLoadInEditor(detail);
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
            if (loadedPackage?.id === updated.id) {
              setLoadedPackage(updated);
              setLoadedPackageTitle(updated.title);
              setModules(updated.modules);
            }
          }}
        />
      )}

      <AzurePushDialog
        state={azurePushDialog}
        onClose={() => setAzurePushDialog(prev => ({ ...prev, open: false }))}
      />

      {runLibraryScriptTarget && (
        <RunLibraryScriptDialog
          scriptId={runLibraryScriptTarget.id}
          scriptTitle={runLibraryScriptTarget.title}
          azureRunbookName={runLibraryScriptTarget.azureRunbookName}
          onClose={() => setRunLibraryScriptTarget(null)}
        />
      )}

      {runLibraryModuleTarget && runLibraryModuleTarget.id && (
        <RunLibraryScriptDialog
          moduleId={runLibraryModuleTarget.id}
          scriptTitle={runLibraryModuleTarget.filename}
          onClose={() => setRunLibraryModuleTarget(null)}
        />
      )}

      {editingModuleId && editingPackageId && editorScript && (
        <PackagePushProgressDialog
          open={modulePushOpen}
          packageId={editingPackageId}
          modules={[{ filename: editorScript.title, description: editorScript.description }]}
          token={token}
          onClose={() => setModulePushOpen(false)}
        />
      )}

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.title.startsWith("Discard") ? "Discard changes" : "Delete"}
        destructive={!confirmState.title.startsWith("Discard")}
        onConfirm={() => {
          setConfirmState((s) => ({ ...s, open: false }));
          confirmState.onConfirm();
        }}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
      />

      <NewScriptSetDialog
        open={newScriptSetDialogOpen}
        token={token}
        onClose={() => setNewScriptSetDialogOpen(false)}
        onCreated={(pkg) => {
          setNewScriptSetDialogOpen(false);
          setPackages((prev) => [pkg, ...prev]);
          handleSidebarPackageClick(pkg);
          setOpenDrawerPackage(pkg);
          toast({ title: "Script Set created", description: `"${pkg.title}" is ready — add modules to it now.` });
        }}
      />
    </div>
  );
}
