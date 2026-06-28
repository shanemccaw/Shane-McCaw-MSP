import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Trash2, Pencil, Play, RefreshCw, X, Tag, ChevronRight, ChevronUp, ChevronDown, TerminalSquare, Sparkles, Upload, FileCode } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnalyzeResult {
  name?: string;
  runbookName?: string;
  description?: string;
  aiInstructions?: string;
  executionMode?: "automated" | "manual";
  manualRequirements?: string[];
  appRegPermissions?: AppRegPermission[];
  psScriptBody?: string;
}

interface AppRegPermission {
  permission: string;
  type: "Application" | "Delegated";
  reason: string;
}

interface Category {
  id: number;
  name: string;
  displayOrder: number;
}

interface Script {
  id: number;
  name: string;
  description: string | null;
  runbookName: string;
  azureSyncedAt: string | null;
  appRegPermissions: AppRegPermission[];
  aiInstructions: string | null;
  executionMode: "automated" | "manual";
  manualRequirements: string[];
  psScriptBody: string | null;
  categoryIds: number[];
}

interface RunbookSummary {
  name: string;
  runbookType?: string;
}

interface AzureCredential {
  id: number;
  tenantId: string;
  clientId: string;
}

interface ClientWithCred {
  id: number;
  name: string | null;
  email: string;
  credential: AzureCredential | null;
}

// ── Style constants ───────────────────────────────────────────────────────────

const inputCls = "w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 bg-[#161B22] placeholder-[#484F58]";
const labelCls = "block text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-1";

const EMPTY_FORM = {
  name: "",
  description: "",
  runbookName: "",
  appRegPermissions: [] as AppRegPermission[],
  aiInstructions: "",
  executionMode: "automated" as "automated" | "manual",
  manualRequirements: "",
  psScriptBody: "",
  categoryIds: [] as number[],
};

// ── Permission Row ────────────────────────────────────────────────────────────

function PermissionRow({
  perm,
  onChange,
  onRemove,
}: {
  perm: AppRegPermission;
  onChange: (p: AppRegPermission) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_100px_1fr_24px] gap-1.5 items-start">
      <input
        type="text"
        placeholder="e.g. User.Read.All"
        value={perm.permission}
        onChange={e => onChange({ ...perm, permission: e.target.value })}
        className="border border-[#30363D] rounded px-2 py-1 text-xs text-[#E6EDF3] bg-[#1C2128] focus:outline-none focus:ring-1 focus:ring-[#0078D4]/40 placeholder-[#484F58]"
      />
      <select
        value={perm.type}
        onChange={e => onChange({ ...perm, type: e.target.value as "Application" | "Delegated" })}
        className="border border-[#30363D] rounded px-1.5 py-1 text-xs text-[#E6EDF3] bg-[#1C2128] focus:outline-none"
      >
        <option value="Application">App</option>
        <option value="Delegated">Delegated</option>
      </select>
      <input
        type="text"
        placeholder="Reason"
        value={perm.reason}
        onChange={e => onChange({ ...perm, reason: e.target.value })}
        className="border border-[#30363D] rounded px-2 py-1 text-xs text-[#E6EDF3] bg-[#1C2128] focus:outline-none focus:ring-1 focus:ring-[#0078D4]/40 placeholder-[#484F58]"
      />
      <button onClick={onRemove} className="text-red-400 hover:text-red-300 transition-colors h-[26px] flex items-center justify-center">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Script Form Modal ─────────────────────────────────────────────────────────

function ScriptFormModal({
  script,
  categories,
  initialValues,
  onClose,
  onSaved,
}: {
  script: Script | null;
  categories: Category[];
  initialValues?: AnalyzeResult;
  onClose: () => void;
  onSaved: (s: Script) => void;
}) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState(() =>
    script
      ? {
          name: script.name,
          description: script.description ?? "",
          runbookName: script.runbookName,
          appRegPermissions: script.appRegPermissions,
          aiInstructions: script.aiInstructions ?? "",
          executionMode: script.executionMode ?? "automated" as "automated" | "manual",
          manualRequirements: (script.manualRequirements ?? []).join("\n"),
          psScriptBody: script.psScriptBody ?? "",
          categoryIds: script.categoryIds ?? [] as number[],
        }
      : {
          ...EMPTY_FORM,
          ...(initialValues ? {
            name: initialValues.name ?? "",
            description: initialValues.description ?? "",
            runbookName: initialValues.runbookName ?? "",
            aiInstructions: initialValues.aiInstructions ?? "",
            executionMode: initialValues.executionMode ?? "automated" as "automated" | "manual",
            manualRequirements: (initialValues.manualRequirements ?? []).join("\n"),
            psScriptBody: initialValues.psScriptBody ?? "",
          } : {}),
          appRegPermissions: initialValues?.appRegPermissions ?? [] as AppRegPermission[],
          categoryIds: [] as number[],
        }
  );
  const [saving, setSaving] = useState(false);
  const [runbooks, setRunbooks] = useState<RunbookSummary[]>([]);
  const [loadingRunbooks, setLoadingRunbooks] = useState(true);
  const [refreshingRunbooks, setRefreshingRunbooks] = useState(false);
  const [azureConfigured, setAzureConfigured] = useState(true);

  const fetchRunbooks = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshingRunbooks(true); else setLoadingRunbooks(true);
    let cancelled = false;
    fetchWithAuth("/api/admin/runbooks")
      .then(async res => {
        if (cancelled) return;
        if (res.status === 503) {
          const body = await res.json() as { configured: boolean };
          if (!body.configured) { if (!isRefresh) setAzureConfigured(false); return; }
        }
        if (!res.ok) return;
        const body = await res.json() as { configured: boolean; runbooks: RunbookSummary[] };
        setRunbooks(body.runbooks ?? []);
        setAzureConfigured(true);
      })
      .catch(() => { if (!cancelled && !isRefresh) setAzureConfigured(false); })
      .finally(() => { if (!cancelled) { setLoadingRunbooks(false); setRefreshingRunbooks(false); } });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { return fetchRunbooks(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const addPerm = () => setForm(f => ({ ...f, appRegPermissions: [...f.appRegPermissions, { permission: "", type: "Application" as const, reason: "" }] }));
  const updatePerm = (i: number, p: AppRegPermission) => setForm(f => ({ ...f, appRegPermissions: f.appRegPermissions.map((x, idx) => idx === i ? p : x) }));
  const removePerm = (i: number) => setForm(f => ({ ...f, appRegPermissions: f.appRegPermissions.filter((_, idx) => idx !== i) }));

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Script name is required", variant: "destructive" }); return; }
    if (!form.runbookName.trim()) { toast({ title: azureConfigured ? "Please select a runbook" : "Runbook name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = script ? `/api/admin/scripts/${script.id}` : "/api/admin/scripts";
      const method = script ? "PUT" : "POST";
      const res = await fetchWithAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          runbookName: form.runbookName.trim(),
          appRegPermissions: form.executionMode === "manual" ? [] : form.appRegPermissions.filter(p => p.permission.trim()),
          aiInstructions: form.aiInstructions.trim() || undefined,
          executionMode: form.executionMode,
          manualRequirements: form.manualRequirements.trim()
            ? form.manualRequirements.split("\n").map(l => l.trim()).filter(Boolean)
            : [],
          psScriptBody: form.executionMode === "manual" && form.psScriptBody.trim() ? form.psScriptBody.trim() : undefined,
          categoryIds: form.categoryIds,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to save script", variant: "destructive" });
        return;
      }
      const saved = await res.json() as Script;
      onSaved(saved);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full bg-[#161B22] border-l border-[#30363D] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#30363D] flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-[#E6EDF3]">{script ? "Edit Script" : "New Script"}</h2>
            <p className="text-[10px] text-[#7D8590] mt-0.5">Catalog entry</p>
          </div>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className={labelCls}>Script Name *</label>
            <input type="text" placeholder="e.g. MFA Status Audit" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Description</label>
            <textarea placeholder="Brief description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className={`${inputCls} resize-none`} />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className={`${labelCls} mb-0`}>Runbook Name *</label>
              {azureConfigured && !loadingRunbooks && (
                <button type="button" onClick={() => fetchRunbooks(true)} disabled={refreshingRunbooks} className="text-[#484F58] hover:text-[#7D8590] disabled:opacity-50">
                  <RefreshCw className={`w-3 h-3 ${refreshingRunbooks ? "animate-spin" : ""}`} />
                </button>
              )}
            </div>
            {loadingRunbooks ? (
              <div className={`${inputCls} animate-pulse bg-[#1C2128] text-transparent select-none`}>Loading…</div>
            ) : azureConfigured ? (
              <select value={form.runbookName} onChange={e => setForm(f => ({ ...f, runbookName: e.target.value }))} disabled={refreshingRunbooks} className={`${inputCls} font-mono`}>
                <option value="" disabled>— select a runbook —</option>
                {runbooks.map(rb => <option key={rb.name} value={rb.name}>{rb.name}{rb.runbookType ? ` (${rb.runbookType})` : ""}</option>)}
                {form.runbookName && !runbooks.some(rb => rb.name === form.runbookName) && (
                  <option value={form.runbookName} disabled>{form.runbookName} (not in Azure)</option>
                )}
              </select>
            ) : (
              <input type="text" placeholder="e.g. Check-MFAStatus" value={form.runbookName} onChange={e => setForm(f => ({ ...f, runbookName: e.target.value }))} className={`${inputCls} font-mono`} />
            )}
          </div>

          <div>
            <label className={labelCls}>Execution Mode</label>
            <div className="flex gap-2">
              {(["automated", "manual"] as const).map(mode => (
                <button key={mode} type="button" onClick={() => setForm(f => ({ ...f, executionMode: mode }))}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold border transition-colors ${
                    form.executionMode === mode
                      ? mode === "automated" ? "bg-[#0078D4]/20 border-[#0078D4]/50 text-[#0078D4]" : "bg-amber-500/20 border-amber-500/40 text-amber-400"
                      : "bg-[#1C2128] border-[#30363D] text-[#484F58] hover:text-[#7D8590]"
                  }`}
                >
                  {mode === "automated" ? "⚡ Automated" : "📋 Manual"}
                </button>
              ))}
            </div>
          </div>

          {form.executionMode === "manual" && (
            <div>
              <label className={labelCls}>Why Manual? (Requirements)</label>
              <textarea placeholder={"One requirement per line…"} value={form.manualRequirements} onChange={e => setForm(f => ({ ...f, manualRequirements: e.target.value }))} rows={3} className={`${inputCls} resize-y`} />
            </div>
          )}

          {form.executionMode === "automated" && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={`${labelCls} mb-0`}>App Registration Permissions</label>
                <button onClick={addPerm} className="flex items-center gap-1 text-[10px] font-semibold text-[#0078D4] hover:text-[#1A90E0]">
                  <Plus className="w-3 h-3" />Add
                </button>
              </div>
              {form.appRegPermissions.length === 0 ? (
                <p className="text-xs text-[#484F58] italic">No permissions defined.</p>
              ) : (
                <div className="space-y-1.5">
                  {form.appRegPermissions.map((p, i) => (
                    <PermissionRow key={i} perm={p} onChange={updated => updatePerm(i, updated)} onRemove={() => removePerm(i)} />
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className={labelCls}>AI Instructions</label>
            <textarea placeholder="Instructions for AI analysis of script output…" value={form.aiInstructions} onChange={e => setForm(f => ({ ...f, aiInstructions: e.target.value }))} rows={3} className={`${inputCls} resize-y`} />
          </div>

          {categories.length > 0 && (
            <div>
              <label className={labelCls}>Categories</label>
              <div className="grid grid-cols-2 gap-1 mt-0.5">
                {categories.map(cat => {
                  const checked = form.categoryIds.includes(cat.id);
                  return (
                    <label key={cat.id} className={`flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer transition-colors select-none ${checked ? "border-[#0078D4]/60 bg-[#0078D4]/10 text-[#E6EDF3]" : "border-[#30363D] bg-[#1C2128] text-[#7D8590] hover:bg-[#21262D]"}`}>
                      <input type="checkbox" className="hidden" checked={checked} onChange={() => setForm(f => ({ ...f, categoryIds: checked ? f.categoryIds.filter(id => id !== cat.id) : [...f.categoryIds, cat.id] }))} />
                      <Tag className={`w-2.5 h-2.5 flex-shrink-0 ${checked ? "text-[#0078D4]" : "text-[#484F58]"}`} />
                      <span className="text-xs truncate">{cat.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-[#30363D] flex-shrink-0">
          <button onClick={onClose} className="text-sm text-[#7D8590] hover:text-[#E6EDF3] font-medium transition-colors">Cancel</button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || loadingRunbooks}
            className="flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#006CBE] text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? "Saving…" : script ? "Save Changes" : "Create Script"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Run Script Modal ──────────────────────────────────────────────────────────

function RunScriptModal({ script, onClose }: { script: Script; onClose: () => void }) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [clients, setClients] = useState<ClientWithCred[]>([]);
  const [loadingCreds, setLoadingCreds] = useState(true);
  const [selectedClientId, setSelectedClientId] = useState<number | "">("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [findings, setFindings] = useState<string[]>([]);

  useEffect(() => {
    fetchWithAuth("/api/admin/clients/with-azure-credentials")
      .then(r => r.json() as Promise<ClientWithCred[]>)
      .then(d => setClients(d.filter(c => c.credential !== null)))
      .catch(() => {})
      .finally(() => setLoadingCreds(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedClient = clients.find(c => c.id === selectedClientId);

  const handleRun = async () => {
    if (!selectedClientId || !selectedClient?.credential) return;
    setRunning(true);
    try {
      const res = await fetchWithAuth("/api/admin/run-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptId: script.id,
          credentialId: selectedClient.credential.id,
          customerId: selectedClient.id,
        }),
      });
      const data = await res.json() as { status?: string; findings?: string[]; error?: string };
      if (!res.ok) {
        toast({ title: data.error ?? "Script run failed", variant: "destructive" });
      } else {
        setFindings(data.findings ?? []);
        setDone(true);
        toast({
          title: `Script run ${data.status ?? "complete"}`,
          description: data.findings?.length
            ? `${data.findings.length} finding${data.findings.length !== 1 ? "s" : ""} — check Run Results`
            : "No findings — see Run Results for details",
        });
      }
    } catch {
      toast({ title: "Network error — could not reach the server", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D]">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[#E6EDF3]">Run Script</p>
            <p className="text-[10px] text-[#7D8590] font-mono mt-0.5 truncate">{script.name}</p>
          </div>
          <button onClick={onClose} className="text-[#484F58] hover:text-[#E6EDF3] transition-colors ml-2 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {done ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <p className="text-sm font-semibold text-green-400">Run complete</p>
              </div>
              {findings.length > 0 ? (
                <div className="bg-[#1C2128] border border-[#30363D] rounded-lg p-3 space-y-1.5 max-h-48 overflow-y-auto">
                  {findings.map((f, i) => (
                    <p key={i} className="text-xs text-[#C9D1D9] leading-relaxed flex gap-2">
                      <span className="text-[#0078D4] flex-shrink-0 mt-0.5">•</span>
                      {f}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#7D8590] italic">No findings — check Run Results for full output.</p>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className={labelCls}>Client</label>
                {loadingCreds ? (
                  <div className="h-9 bg-[#1C2128] rounded-lg animate-pulse" />
                ) : clients.length === 0 ? (
                  <p className="text-xs text-[#484F58] italic py-2">No clients with Azure credentials found.</p>
                ) : (
                  <select
                    className={inputCls}
                    value={selectedClientId}
                    onChange={e => setSelectedClientId(e.target.value ? Number(e.target.value) : "")}
                  >
                    <option value="">Select a client…</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name ?? c.email}</option>
                    ))}
                  </select>
                )}
              </div>

              {selectedClient?.credential && (
                <div className="text-[10px] text-[#7D8590] font-mono bg-[#1C2128] border border-[#30363D] rounded-lg px-3 py-2">
                  <span className="font-sans font-semibold text-[#484F58] mr-1">Tenant:</span>{selectedClient.credential.tenantId}
                  <span className="mx-2 text-[#30363D]">·</span>
                  <span className="font-sans font-semibold text-[#484F58] mr-1">App:</span>{selectedClient.credential.clientId}
                </div>
              )}

              <div className="flex items-center gap-1.5 text-[10px] text-[#484F58]">
                <span>Runbook:</span>
                <span className="font-mono text-[#7D8590] bg-[#1C2128] border border-[#30363D] rounded px-1.5 py-0.5">{script.runbookName}</span>
                {script.executionMode === "manual" && (
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold uppercase tracking-wider text-[9px]">Manual</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 pb-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#30363D] transition-colors"
          >
            {done ? "Close" : "Cancel"}
          </button>
          {!done && (
            <button
              onClick={() => void handleRun()}
              disabled={!selectedClientId || running || loadingCreds}
              className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#006CBE] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {running ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Running…</>
              ) : (
                <><Play className="w-4 h-4" />Run Script</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Register from Script Sheet ────────────────────────────────────────────────

const inputClsR = "w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 bg-[#161B22] placeholder-[#484F58]";
const labelClsR = "block text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-1";

function RegisterFromScriptSheet({
  onClose,
  onResult,
}: {
  onClose: () => void;
  onResult: (r: AnalyzeResult) => void;
}) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [psBody, setPsBody] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [showAnnotation, setShowAnnotation] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result;
      if (typeof text === "string") setPsBody(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleAnalyze = async () => {
    if (!psBody.trim()) {
      toast({ title: "Paste or upload a PowerShell script first", variant: "destructive" });
      return;
    }
    setAnalyzing(true);
    try {
      const res = await fetchWithAuth("/api/admin/scripts/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ psScriptBody: psBody }),
      });
      const body = await res.json() as AnalyzeResult & { error?: string };
      if (!res.ok) {
        toast({ title: (body as { error?: string }).error ?? "Analysis failed", variant: "destructive" });
        return;
      }
      onResult(body);
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full bg-[#161B22] border-l border-[#30363D] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363D] flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#0078D4]" />
              <h2 className="text-base font-bold text-[#E6EDF3]">Register from Script</h2>
            </div>
            <p className="text-xs text-[#7D8590] mt-0.5">Paste or upload a .ps1 file — AI fills in the catalog entry for you</p>
          </div>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="bg-[#0D1117] border border-[#30363D] rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAnnotation(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#161B22] transition-colors"
            >
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-[#484F58]" />
                <span className="text-xs font-semibold text-[#7D8590]">How to annotate your script</span>
              </div>
              <ChevronRight className={`w-4 h-4 text-[#484F58] transition-transform ${showAnnotation ? "rotate-90" : ""}`} />
            </button>
            {showAnnotation && (
              <div className="px-4 pb-4 space-y-3 border-t border-[#30363D]">
                <p className="text-xs text-[#7D8590] mt-3 leading-relaxed">
                  Add a <code className="bg-[#1C2128] px-1 rounded text-[#E6EDF3] text-[11px]">&lt;# … #&gt;</code> comment block at the top of your script with these fields. The AI will use them to pre-fill the Name and Runbook fields, then generate everything else automatically.
                </p>
                <pre className="text-[11px] text-[#E6EDF3] font-mono bg-[#1C2128] border border-[#30363D] rounded-lg p-3 leading-relaxed select-all">{`<#
.CATALOG_NAME   MFA Status Audit
.CATALOG_RUNBOOK  Check-MFAStatus
#>

# Your PowerShell script body starts here…
param(
    [string]$TenantId,
    [string]$ClientId,
    [string]$ClientSecret
)

Connect-MgGraph -TenantId $TenantId …`}</pre>
                <p className="text-[10px] text-[#484F58]">
                  <strong className="text-[#7D8590]">.CATALOG_NAME</strong> — friendly display name for the script catalog<br />
                  <strong className="text-[#7D8590]">.CATALOG_RUNBOOK</strong> — exact Azure Automation runbook name (case-sensitive)
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelClsR}>PowerShell Script Body</label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 text-[10px] font-semibold text-[#0078D4] hover:text-[#1A90E0] transition-colors"
              >
                <Upload className="w-3 h-3" />
                Upload .ps1
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".ps1,.txt,text/plain"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
            <textarea
              value={psBody}
              onChange={e => setPsBody(e.target.value)}
              placeholder={"Paste your PowerShell script here…\n\nTip: add a <# .CATALOG_NAME … .CATALOG_RUNBOOK … #> block at the top to pre-fill the name and runbook fields automatically."}
              rows={20}
              className={`${inputClsR} resize-y font-mono text-[11px]`}
            />
            <p className="text-[10px] text-[#484F58] mt-1">
              The AI reads the full script to generate description, AI instructions, app permissions, and category tags
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[#30363D] flex-shrink-0">
          <button onClick={onClose} className="text-sm text-[#7D8590] hover:text-[#E6EDF3] font-medium transition-colors">
            Cancel
          </button>
          <button
            onClick={() => void handleAnalyze()}
            disabled={analyzing || !psBody.trim()}
            className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#006CBE] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
          >
            {analyzing ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Analyzing…</>
            ) : (
              <><Sparkles className="w-4 h-4" />Analyze Script</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Catalog Sidebar Panel ─────────────────────────────────────────────────────

export default function CatalogSidebarPanel({
  onRunScript,
}: {
  onRunScript: (runbookName: string) => void;
}) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [scripts, setScripts] = useState<Script[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Set<number>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editScript, setEditScript] = useState<Script | null>(null);
  const [formInitialValues, setFormInitialValues] = useState<AnalyzeResult | undefined>(undefined);
  const [showRegister, setShowRegister] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Script | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [runScriptTarget, setRunScriptTarget] = useState<Script | null>(null);
  const initDone = useRef(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, cRes] = await Promise.all([
        fetchWithAuth("/api/admin/scripts"),
        fetchWithAuth("/api/admin/script-categories"),
      ]);
      if (sRes.ok) setScripts(await sRes.json() as Script[]);
      if (cRes.ok) {
        const cats = await cRes.json() as Category[];
        setCategories(cats);
        if (!initDone.current) {
          initDone.current = true;
          setOpenSections(new Set(cats.map(c => c.id)));
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const handleSaved = (saved: Script) => {
    setScripts(prev => {
      const exists = prev.find(s => s.id === saved.id);
      return exists ? prev.map(s => s.id === saved.id ? saved : s) : [...prev, saved];
    });
    setShowForm(false);
    setEditScript(null);
    toast({ title: "Script saved" });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/scripts/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to delete script", variant: "destructive" });
        return;
      }
      setScripts(prev => prev.filter(s => s.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast({ title: "Script deleted" });
    } finally {
      setDeleting(false);
    }
  };

  const toggleSection = (id: number) =>
    setOpenSections(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const q = search.toLowerCase();
  const filteredScripts = scripts.filter(s =>
    !q || s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q) || s.runbookName.toLowerCase().includes(q)
  );

  const sortedCats = [...categories].sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

  const catMap = new Map<number, Script[]>();
  const uncategorised: Script[] = [];
  for (const s of filteredScripts) {
    if (!s.categoryIds || s.categoryIds.length === 0) {
      uncategorised.push(s);
    } else {
      for (const cid of s.categoryIds) {
        if (!catMap.has(cid)) catMap.set(cid, []);
        catMap.get(cid)!.push(s);
      }
    }
  }

  const UNCATEGORISED_KEY = -1;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0D1117]">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[#21262D] flex-shrink-0">
        <div className="relative flex-1">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#484F58]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search scripts…"
            className="w-full bg-[#161B22] border border-[#30363D] rounded pl-6 pr-2 py-1 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/50"
          />
        </div>
        <button
          onClick={() => { setEditScript(null); setFormInitialValues(undefined); setShowForm(true); }}
          title="New Script"
          className="p-1.5 text-[#484F58] hover:text-[#0078D4] hover:bg-[#0078D4]/10 rounded transition-colors flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setShowRegister(true)}
          title="Register from Script (AI)"
          className="p-1.5 text-[#484F58] hover:text-[#0078D4] hover:bg-[#0078D4]/10 rounded transition-colors flex-shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => void loadAll()} title="Refresh" className="p-1.5 text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#21262D] rounded transition-colors flex-shrink-0">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filteredScripts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <TerminalSquare className="w-8 h-8 text-[#21262D] mb-2" />
            <p className="text-xs text-[#484F58]">{scripts.length === 0 ? "No scripts in catalog yet" : "No results"}</p>
            {scripts.length === 0 && (
              <button onClick={() => { setEditScript(null); setShowForm(true); }} className="mt-3 text-xs text-[#0078D4] hover:text-[#1A90E0]">Create first script →</button>
            )}
          </div>
        )}

        {!loading && (
          <CategoryManagerPanel categories={categories} onChanged={() => void loadAll()} />
        )}

        {!loading && filteredScripts.length > 0 && (
          <div>
            {/* Categorised sections */}
            {sortedCats.map(cat => {
              const catScripts = catMap.get(cat.id) ?? [];
              if (catScripts.length === 0) return null;
              const isOpen = openSections.has(cat.id);
              return (
                <div key={cat.id}>
                  <button
                    onClick={() => toggleSection(cat.id)}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-[#161B22] transition-colors"
                  >
                    <ChevronRight className={`w-3 h-3 text-[#484F58] flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    <Tag className="w-2.5 h-2.5 text-[#0078D4] flex-shrink-0" />
                    <span className="flex-1 text-left text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide truncate">{cat.name}</span>
                    <span className="text-[9px] px-1 py-0.5 rounded-full bg-[#21262D] text-[#484F58] border border-[#30363D] flex-shrink-0">{catScripts.length}</span>
                  </button>
                  {isOpen && catScripts.map(s => (
                    <ScriptListRow key={s.id} s={s} onEdit={() => { setEditScript(s); setShowForm(true); }} onDelete={() => setDeleteTarget(s)} onRun={() => setRunScriptTarget(s)} />
                  ))}
                </div>
              );
            })}

            {/* Uncategorised */}
            {uncategorised.length > 0 && (
              <div>
                <button onClick={() => toggleSection(UNCATEGORISED_KEY)} className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-[#161B22] transition-colors">
                  <ChevronRight className={`w-3 h-3 text-[#484F58] flex-shrink-0 transition-transform ${openSections.has(UNCATEGORISED_KEY) ? "rotate-90" : ""}`} />
                  <span className="flex-1 text-left text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide">Uncategorised</span>
                  <span className="text-[9px] px-1 py-0.5 rounded-full bg-[#21262D] text-[#484F58] border border-[#30363D] flex-shrink-0">{uncategorised.length}</span>
                </button>
                {openSections.has(UNCATEGORISED_KEY) && uncategorised.map(s => (
                  <ScriptListRow key={s.id} s={s} onEdit={() => { setEditScript(s); setShowForm(true); }} onDelete={() => setDeleteTarget(s)} onRun={() => setRunScriptTarget(s)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Run Script Modal */}
      {runScriptTarget && (
        <RunScriptModal
          script={runScriptTarget}
          onClose={() => setRunScriptTarget(null)}
        />
      )}

      {/* Modals */}
      {showRegister && (
        <RegisterFromScriptSheet
          onClose={() => setShowRegister(false)}
          onResult={result => {
            setShowRegister(false);
            setEditScript(null);
            setFormInitialValues(result);
            setShowForm(true);
          }}
        />
      )}

      {showForm && (
        <ScriptFormModal
          script={editScript}
          categories={categories}
          initialValues={editScript ? undefined : formInitialValues}
          onClose={() => { setShowForm(false); setEditScript(null); setFormInitialValues(undefined); }}
          onSaved={handleSaved}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-[#161B22] border border-[#30363D] text-[#E6EDF3]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Script</AlertDialogTitle>
            <AlertDialogDescription className="text-[#7D8590]">
              Delete <strong className="text-[#E6EDF3]">{deleteTarget?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-[#1C2128] border-[#30363D] text-[#E6EDF3] hover:bg-[#30363D]">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Category Manager Panel ────────────────────────────────────────────────────

function CategoryManagerPanel({
  categories,
  onChanged,
}: {
  categories: Category[];
  onChanged: () => void;
}) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  const sorted = [...categories].sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/admin/script-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), displayOrder: categories.length }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to create category", variant: "destructive" }); return;
      }
      setNewName(""); onChanged();
    } finally { setSaving(false); }
  };

  const handleRename = async (id: number) => {
    const trimmed = editName.trim();
    setEditId(null);
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/script-categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to rename category", variant: "destructive" }); return;
      }
      onChanged();
    } finally { setSaving(false); }
  };

  const handleMove = async (cat: Category, dir: -1 | 1) => {
    const idx = sorted.findIndex(c => c.id === cat.id);
    const next = idx + dir;
    if (next < 0 || next >= sorted.length) return;
    const neighbour = sorted[next];
    setSaving(true);
    try {
      const [r1, r2] = await Promise.all([
        fetchWithAuth(`/api/admin/script-categories/${cat.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayOrder: neighbour.displayOrder }),
        }),
        fetchWithAuth(`/api/admin/script-categories/${neighbour.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayOrder: cat.displayOrder }),
        }),
      ]);
      if (!r1.ok || !r2.ok) { toast({ title: "Failed to reorder categories", variant: "destructive" }); return; }
      onChanged();
    } catch { toast({ title: "Failed to reorder categories", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/script-categories/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to delete category", variant: "destructive" }); return;
      }
      setDeleteTarget(null); onChanged();
    } finally { setSaving(false); }
  };

  return (
    <>
      <div className="border-t border-[#21262D] bg-[#0D1117]">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[#161B22] transition-colors"
        >
          <div className="flex items-center gap-2">
            <Tag className="w-3 h-3 text-[#0078D4]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590]">Manage Categories</span>
            <span className="text-[9px] text-[#484F58] bg-[#161B22] border border-[#30363D] rounded px-1 py-0.5">{categories.length}</span>
          </div>
          <div className="flex items-center gap-1">
            {saving && <Loader2 className="w-3 h-3 text-[#0078D4] animate-spin" />}
            <ChevronDown className={`w-3 h-3 text-[#484F58] transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
          </div>
        </button>

        {open && (
          <div className="px-3 pb-3 space-y-2">
            {sorted.length === 0 ? (
              <p className="text-[10px] text-[#484F58] italic text-center py-1">No categories yet</p>
            ) : (
              <div className="space-y-1">
                {sorted.map((cat, idx) => (
                  <div key={cat.id} className="flex items-center gap-1.5 bg-[#161B22] border border-[#30363D] rounded-lg px-2 py-1.5">
                    <div className="flex flex-col gap-0 flex-shrink-0">
                      <button onClick={() => void handleMove(cat, -1)} disabled={idx === 0 || saving} className="text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-30 transition-colors">
                        <ChevronUp className="w-2.5 h-2.5" />
                      </button>
                      <button onClick={() => void handleMove(cat, 1)} disabled={idx === sorted.length - 1 || saving} className="text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-30 transition-colors">
                        <ChevronDown className="w-2.5 h-2.5" />
                      </button>
                    </div>
                    {editId === cat.id ? (
                      <input
                        autoFocus
                        className="flex-1 min-w-0 text-[10px] bg-[#0D1117] border border-[#0078D4]/50 rounded px-1.5 py-0.5 text-[#E6EDF3] focus:outline-none"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onBlur={() => void handleRename(cat.id)}
                        onKeyDown={e => { if (e.key === "Enter") void handleRename(cat.id); if (e.key === "Escape") setEditId(null); }}
                      />
                    ) : (
                      <span
                        className="flex-1 min-w-0 text-[10px] text-[#E6EDF3] cursor-text hover:text-white truncate"
                        onDoubleClick={() => { setEditId(cat.id); setEditName(cat.name); }}
                        title="Double-click to rename"
                      >
                        {cat.name}
                      </span>
                    )}
                    <button onClick={() => { setEditId(cat.id); setEditName(cat.name); }} className="text-[#484F58] hover:text-[#0078D4] transition-colors flex-shrink-0" title="Rename">
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                    <button onClick={() => setDeleteTarget(cat)} className="text-[#484F58] hover:text-red-400 transition-colors flex-shrink-0" title="Delete">
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1.5 pt-1 border-t border-[#21262D]">
              <input
                type="text"
                placeholder="New category…"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void handleCreate(); }}
                className="flex-1 min-w-0 border border-[#30363D] rounded px-2 py-1 text-[10px] text-[#E6EDF3] bg-[#161B22] focus:outline-none focus:border-[#0078D4]/50 placeholder-[#484F58]"
              />
              <button
                onClick={() => void handleCreate()}
                disabled={!newName.trim() || saving}
                className="flex items-center gap-0.5 px-2 py-1 text-[10px] font-semibold text-white bg-[#0078D4] hover:bg-[#006CBE] disabled:opacity-50 rounded transition-colors flex-shrink-0"
              >
                <Plus className="w-3 h-3" />Add
              </button>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-[#161B22] border border-[#30363D] text-[#E6EDF3]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription className="text-[#7D8590]">
              Delete <strong className="text-[#E6EDF3]">{deleteTarget?.name}</strong>? Scripts in this category will become uncategorised.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-[#1C2128] border-[#30363D] text-[#E6EDF3] hover:bg-[#30363D]">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white">
              {saving ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Script list row ───────────────────────────────────────────────────────────

function ScriptListRow({
  s,
  onEdit,
  onDelete,
  onRun,
}: {
  s: Script;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 pl-7 pr-2 py-1 hover:bg-[#161B22] transition-colors group">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[#C9D1D9] truncate">{s.name}</p>
        {s.description && <p className="text-[10px] text-[#484F58] truncate">{s.description}</p>}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={onRun}
          title={`Run "${s.name}" in IDE runner`}
          className="p-1 text-[#484F58] hover:text-green-400 hover:bg-green-400/10 rounded transition-colors"
        >
          <Play className="w-3 h-3" />
        </button>
        <button onClick={onEdit} title="Edit" className="p-1 text-[#484F58] hover:text-[#0078D4] hover:bg-[#0078D4]/10 rounded transition-colors">
          <Pencil className="w-3 h-3" />
        </button>
        <button onClick={onDelete} title="Delete" className="p-1 text-[#484F58] hover:text-red-400 hover:bg-red-400/10 rounded transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
