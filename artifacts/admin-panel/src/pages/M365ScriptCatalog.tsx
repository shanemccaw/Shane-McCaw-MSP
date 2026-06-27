import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
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
import { Loader2, Plus, Trash2, Pencil, ChevronUp, ChevronDown, Copy, Check, TerminalSquare, X, Play, RefreshCw, ChevronRight, Tag } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AppRegPermission {
  permission: string;
  type: "Application" | "Delegated";
  reason: string;
}

interface Category {
  id: number;
  name: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface Script {
  id: number;
  name: string;
  description: string | null;
  runbookName: string;
  appRegPermissions: AppRegPermission[];
  aiInstructions: string | null;
  executionMode: "automated" | "manual";
  manualRequirements: string[];
  psScriptBody: string | null;
  categoryIds: number[];
  createdAt: string;
  updatedAt: string;
}

interface PackageScript {
  id: number;
  packageId: number;
  scriptId: number;
  runOrder: number;
  createdAt: string;
  script: {
    id: number;
    name: string;
    description: string | null;
    runbookName: string;
    appRegPermissions: AppRegPermission[];
    aiInstructions: string | null;
    executionMode: "automated" | "manual";
    manualRequirements: string[];
  };
}

interface PackageRunScriptResult {
  scriptId: number;
  scriptName: string;
  runOrder: number;
  runResultId: number;
  jobId: string | null;
  status: string;
  executionMode: "automated" | "manual";
  findings: string[];
  recommendations: string[];
  scoreImpact: Record<string, number>;
  psContent?: string;
  instructions?: string;
  filename?: string;
  uploadUrl?: string;
  reused?: boolean;
  packageCreatedAt?: string;
}

interface PackageRunResult {
  packageId: number;
  customerId: number | null;
  totalScripts: number;
  completedCount: number;
  failedCount: number;
  awaitingUploadCount?: number;
  requiresManualExecution?: boolean;
  results: PackageRunScriptResult[];
}

interface Service {
  id: number;
  name: string;
  serviceType: string | null;
  category: string | null;
}

interface AzureCredential {
  id: number;
  displayName: string;
  tenantId: string;
  clientId: string;
  credentialType: "secret" | "certificate";
  keyVaultSecretName: string;
  clientUserId: number | null;
}

interface ClientWithCred {
  id: number;
  name: string | null;
  email: string;
  credential: {
    id: number;
    displayName: string;
    tenantId: string;
    clientId: string;
    credentialType: "secret" | "certificate";
  } | null;
}

interface AppRegRequirements {
  packageId: number;
  totalScripts: number;
  totalPermissions: number;
  applicationPermissions: AppRegPermission[];
  delegatedPermissions: AppRegPermission[];
  instructions: string | string[];
}

// ── Style constants ───────────────────────────────────────────────────────────

const inputCls = "w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 bg-[#161B22] placeholder-[#484F58]";
const labelCls = "block text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-1";

// ── Permission Tag Editor ─────────────────────────────────────────────────────

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
    <div className="grid grid-cols-[1fr_130px_1fr_28px] gap-2 items-start">
      <input
        type="text"
        placeholder="e.g. User.Read.All"
        value={perm.permission}
        onChange={e => onChange({ ...perm, permission: e.target.value })}
        className="border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] bg-[#1C2128] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 placeholder-[#484F58]"
      />
      <select
        value={perm.type}
        onChange={e => onChange({ ...perm, type: e.target.value as "Application" | "Delegated" })}
        className="border border-[#30363D] rounded-lg px-2 py-1.5 text-xs text-[#E6EDF3] bg-[#1C2128] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
      >
        <option value="Application">Application</option>
        <option value="Delegated">Delegated</option>
      </select>
      <input
        type="text"
        placeholder="Reason / description"
        value={perm.reason}
        onChange={e => onChange({ ...perm, reason: e.target.value })}
        className="border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] bg-[#1C2128] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 placeholder-[#484F58]"
      />
      <button
        onClick={onRemove}
        className="text-red-400 hover:text-red-300 transition-colors h-[30px] flex items-center justify-center"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Runbook types ─────────────────────────────────────────────────────────────

interface RunbookSummary {
  name: string;
  description?: string;
  runbookType?: string;
  state?: string;
}

// ── Script Form Modal ─────────────────────────────────────────────────────────

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

function ScriptFormModal({
  script,
  categories,
  onClose,
  onSaved,
}: {
  script: Script | null;
  categories: Category[];
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
      : { ...EMPTY_FORM, appRegPermissions: [] as AppRegPermission[] }
  );
  const [saving, setSaving] = useState(false);

  const [runbooks, setRunbooks] = useState<RunbookSummary[]>([]);
  const [loadingRunbooks, setLoadingRunbooks] = useState(true);
  const [refreshingRunbooks, setRefreshingRunbooks] = useState(false);
  const [azureConfigured, setAzureConfigured] = useState(true);

  const fetchRunbooks = useCallback((isRefresh = false) => {
    if (isRefresh) {
      setRefreshingRunbooks(true);
    } else {
      setLoadingRunbooks(true);
    }
    let cancelled = false;
    fetchWithAuth("/api/admin/runbooks")
      .then(async res => {
        if (cancelled) return;
        if (res.status === 503) {
          const body = await res.json() as { configured: boolean };
          if (!body.configured) {
            if (isRefresh) {
              toast({ title: "Could not refresh runbooks — please try again", variant: "destructive" });
            } else {
              setAzureConfigured(false);
            }
            return;
          }
        }
        if (!res.ok) {
          if (isRefresh) {
            toast({ title: "Could not refresh runbooks — please try again", variant: "destructive" });
          }
          return;
        }
        const body = await res.json() as { configured: boolean; runbooks: RunbookSummary[] };
        setRunbooks(body.runbooks ?? []);
        setAzureConfigured(true);
      })
      .catch(() => {
        if (!cancelled) {
          if (isRefresh) {
            toast({ title: "Could not refresh runbooks — please try again", variant: "destructive" });
          } else {
            setAzureConfigured(false);
          }
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingRunbooks(false);
          setRefreshingRunbooks(false);
        }
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return fetchRunbooks(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addPerm = () =>
    setForm(f => ({ ...f, appRegPermissions: [...f.appRegPermissions, { permission: "", type: "Application", reason: "" }] }));

  const updatePerm = (i: number, p: AppRegPermission) =>
    setForm(f => ({ ...f, appRegPermissions: f.appRegPermissions.map((x, idx) => (idx === i ? p : x)) }));

  const removePerm = (i: number) =>
    setForm(f => ({ ...f, appRegPermissions: f.appRegPermissions.filter((_, idx) => idx !== i) }));

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Script name is required", variant: "destructive" });
      return;
    }
    if (!form.runbookName.trim()) {
      toast({
        title: azureConfigured ? "Please select a runbook" : "Runbook name is required",
        description: azureConfigured
          ? runbooks.length === 0
            ? "No runbooks were found in your Azure Automation account."
            : "Choose a runbook from the dropdown before saving."
          : undefined,
        variant: "destructive",
      });
      return;
    }
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
          psScriptBody: form.executionMode === "manual" && form.psScriptBody.trim()
            ? form.psScriptBody.trim()
            : undefined,
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
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full bg-[#161B22] border-l border-[#30363D] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363D] flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-[#E6EDF3]">{script ? "Edit Script" : "New Script"}</h2>
            <p className="text-xs text-[#7D8590] mt-0.5">Define a script in the M365 Command Center catalog</p>
          </div>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <label className={labelCls}>Script Name *</label>
            <input
              type="text"
              placeholder="e.g. MFA Status Audit"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Description</label>
            <textarea
              placeholder="Brief description of what this script does"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className={`${labelCls} mb-0`}>Azure Automation Runbook Name *</label>
              {azureConfigured && !loadingRunbooks && (
                <button
                  type="button"
                  onClick={() => fetchRunbooks(true)}
                  disabled={refreshingRunbooks}
                  title="Refresh runbook list"
                  className="text-[#484F58] hover:text-[#7D8590] transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshingRunbooks ? "animate-spin" : ""}`} />
                </button>
              )}
            </div>
            {loadingRunbooks ? (
              <div className={`${inputCls} animate-pulse bg-[#1C2128] text-transparent select-none`}>
                Loading runbooks…
              </div>
            ) : azureConfigured ? (
              <>
                <select
                  value={form.runbookName}
                  onChange={e => setForm(f => ({ ...f, runbookName: e.target.value }))}
                  disabled={refreshingRunbooks}
                  className={`${inputCls} font-mono ${refreshingRunbooks ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <option value="" disabled>— select a runbook —</option>
                  {runbooks.map(rb => (
                    <option key={rb.name} value={rb.name}>
                      {rb.name}{rb.runbookType ? ` (${rb.runbookType})` : ""}
                    </option>
                  ))}
                  {form.runbookName && !runbooks.some(rb => rb.name === form.runbookName) && (
                    <option value={form.runbookName} disabled>
                      {form.runbookName} (not found in Azure)
                    </option>
                  )}
                </select>
                {runbooks.length === 0 ? (
                  <p className="text-[10px] text-amber-500/70 mt-1">
                    No runbooks found in your Azure Automation account. Create a runbook in Azure first, then refresh.
                  </p>
                ) : (
                  <p className="text-[10px] text-[#484F58] mt-1">
                    Populated from your Azure Automation account — {runbooks.length} runbook{runbooks.length === 1 ? "" : "s"} available
                  </p>
                )}
              </>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="e.g. Check-MFAStatus"
                  value={form.runbookName}
                  onChange={e => setForm(f => ({ ...f, runbookName: e.target.value }))}
                  className={`${inputCls} font-mono`}
                />
                <p className="text-[10px] text-amber-500/70 mt-1">
                  Azure secrets not set — enter the runbook name manually.
                </p>
              </>
            )}
          </div>

          <div>
            <label className={labelCls}>Execution Mode</label>
            <div className="flex gap-2">
              {(["automated", "manual"] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, executionMode: mode }))}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold border transition-colors ${
                    form.executionMode === mode
                      ? mode === "automated"
                        ? "bg-[#0078D4]/20 border-[#0078D4]/50 text-[#0078D4]"
                        : "bg-amber-500/20 border-amber-500/40 text-amber-400"
                      : "bg-[#1C2128] border-[#30363D] text-[#484F58] hover:text-[#7D8590]"
                  }`}
                >
                  {mode === "automated" ? "⚡ Automated" : "📋 Manual (Delegated Auth)"}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[#484F58] mt-1">
              {form.executionMode === "automated"
                ? "Runs unattended via Azure Automation using application credentials from Key Vault"
                : "Requires delegated (interactive) auth — generates a downloadable .ps1 + instruction doc for the customer to run locally"}
            </p>
          </div>

          {form.executionMode === "manual" && (
            <>
              <div>
                <label className={labelCls}>Why Manual? (Requirements)</label>
                <textarea
                  placeholder={"One requirement per line, e.g.:\nRequires MFA-capable account\nNeeds Exchange Admin role\nMust run in customer tenant interactively"}
                  value={form.manualRequirements}
                  onChange={e => setForm(f => ({ ...f, manualRequirements: e.target.value }))}
                  rows={4}
                  className={`${inputCls} resize-y`}
                />
                <p className="text-[10px] text-[#484F58] mt-1">Each line becomes a bullet in the generated instruction document</p>
              </div>
              <div>
                <label className={labelCls}>PowerShell Script Body <span className="text-[#484F58] font-normal">(optional)</span></label>
                <textarea
                  placeholder={"# Data collection logic that will be embedded in the downloadable .ps1\n# Use $TenantId and $UserPrincipalName — they are injected by the wrapper.\n# Assign collected data to $data (hashtable) before this block ends.\n$data = @{\n    users = (Get-MgUser -All | Select-Object Id, DisplayName, UserPrincipalName)\n}"}
                  value={form.psScriptBody}
                  onChange={e => setForm(f => ({ ...f, psScriptBody: e.target.value }))}
                  rows={8}
                  className={`${inputCls} resize-y font-mono text-[11px]`}
                />
                <p className="text-[10px] text-[#484F58] mt-1">Embedded verbatim into the generated .ps1 — leave blank to include a placeholder comment</p>
              </div>
            </>
          )}

          {form.executionMode === "automated" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={`${labelCls} mb-0`}>App Registration Permissions</label>
                <button
                  onClick={addPerm}
                  className="flex items-center gap-1 text-[10px] font-semibold text-[#0078D4] hover:text-[#1A90E0] transition-colors"
                >
                  <Plus className="w-3 h-3" />Add permission
                </button>
              </div>
              {form.appRegPermissions.length === 0 ? (
                <p className="text-xs text-[#484F58] italic py-2">No permissions defined yet.</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_130px_1fr_28px] gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase text-[#484F58]">Permission</span>
                    <span className="text-[10px] font-bold uppercase text-[#484F58]">Type</span>
                    <span className="text-[10px] font-bold uppercase text-[#484F58]">Reason</span>
                    <span />
                  </div>
                  {form.appRegPermissions.map((p, i) => (
                    <PermissionRow
                      key={i}
                      perm={p}
                      onChange={updated => updatePerm(i, updated)}
                      onRemove={() => removePerm(i)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className={labelCls}>AI Instructions</label>
            <textarea
              placeholder="Instructions for the AI analyzer when interpreting output from this script…"
              value={form.aiInstructions}
              onChange={e => setForm(f => ({ ...f, aiInstructions: e.target.value }))}
              rows={5}
              className={`${inputCls} resize-y`}
            />
            <p className="text-[10px] text-[#484F58] mt-1">Used by the AI to generate findings, recommendations, and score impacts</p>
          </div>

          {categories.length > 0 && (
            <div>
              <label className={labelCls}>Categories</label>
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                {categories.map(cat => {
                  const checked = form.categoryIds.includes(cat.id);
                  return (
                    <label
                      key={cat.id}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors select-none ${
                        checked
                          ? "border-[#0078D4]/60 bg-[#0078D4]/10 text-[#E6EDF3]"
                          : "border-[#30363D] bg-[#1C2128] text-[#7D8590] hover:bg-[#21262D]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={checked}
                        onChange={() => {
                          setForm(f => ({
                            ...f,
                            categoryIds: checked
                              ? f.categoryIds.filter(id => id !== cat.id)
                              : [...f.categoryIds, cat.id],
                          }));
                        }}
                      />
                      <Tag className={`w-3 h-3 flex-shrink-0 ${checked ? "text-[#0078D4]" : "text-[#484F58]"}`} />
                      <span className="text-xs font-medium truncate">{cat.name}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] text-[#484F58] mt-1">Assigns this script to one or more categories in the grouped catalog view</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#30363D] flex-shrink-0">
          <button
            onClick={onClose}
            className="text-sm text-[#7D8590] hover:text-[#E6EDF3] font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || loadingRunbooks}
            title={loadingRunbooks ? "Waiting for runbooks to load…" : undefined}
            className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#006CBE] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? "Saving…" : script ? "Save Changes" : "Create Script"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── App Reg Requirements Panel ─────────────────────────────────────────────────

function AppRegRequirementsPanel({ packageId }: { packageId: number }) {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<AppRegRequirements | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!packageId) return;
    setLoading(true);
    fetchWithAuth(`/api/admin/appreg/requirements?packageId=${packageId}`)
      .then(r => r.json() as Promise<AppRegRequirements>)
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);

  const copyText = data
    ? (Array.isArray(data.instructions) ? data.instructions.join("\n") : data.instructions)
    : "";

  const handleCopy = () => {
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (loading) return (
    <div className="bg-[#1C2128] border border-[#30363D] rounded-xl p-4 mt-4">
      <div className="h-4 bg-[#30363D] rounded animate-pulse w-40 mb-2" />
      <div className="h-3 bg-[#30363D] rounded animate-pulse w-full" />
    </div>
  );

  if (!data) return null;

  const instrLines = Array.isArray(data.instructions) ? data.instructions : [data.instructions];

  return (
    <div className="bg-[#1C2128] border border-[#30363D] rounded-xl p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-bold text-[#E6EDF3]">App Registration Requirements</p>
          <p className="text-[10px] text-[#7D8590] mt-0.5">
            {data.totalPermissions} permission{data.totalPermissions !== 1 ? "s" : ""} across {data.totalScripts} script{data.totalScripts !== 1 ? "s" : ""}
          </p>
        </div>
        {data.totalPermissions > 0 && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] hover:text-[#1A90E0] transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </div>
      <pre className="text-[11px] text-[#7D8590] font-mono whitespace-pre-wrap leading-relaxed bg-[#0D1117] border border-[#30363D] rounded-lg p-3 max-h-48 overflow-y-auto">
        {instrLines.join("\n")}
      </pre>
    </div>
  );
}

// ── Manual Script Card (per-script result for manual execution mode) ───────────

function ManualScriptResultCard({
  result,
  onUploaded,
}: {
  result: PackageRunScriptResult;
  onUploaded: (runResultId: number) => void;
}) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string>(result.status);
  const [uploadedFindings, setUploadedFindings] = useState<string[]>([]);

  const handleDownloadPs1 = () => {
    if (!result.psContent) return;
    const blob = new Blob([result.psContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename ?? `${result.scriptName}.ps1`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadInstructions = () => {
    if (!result.instructions) return;
    const blob = new Blob([result.instructions], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.scriptName}_instructions.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const text = await file.text();
      let jsonData: Record<string, unknown>;
      try {
        jsonData = JSON.parse(text) as Record<string, unknown>;
      } catch {
        toast({ title: "Invalid JSON file", description: "The file must be a valid JSON file produced by the PowerShell script", variant: "destructive" });
        return;
      }
      const res = await fetchWithAuth(`/api/admin/manual-scripts/${result.runResultId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonData }),
      });
      const body = await res.json() as { status?: string; findings?: string[]; error?: string };
      if (!res.ok) {
        toast({ title: body.error ?? "Upload failed", variant: "destructive" });
        return;
      }
      setStatus("completed");
      setUploadedFindings(body.findings ?? []);
      toast({ title: "Results uploaded", description: "AI analysis complete — findings and recommendations saved" });
      onUploaded(result.runResultId);
    } catch {
      toast({ title: "Upload failed", description: "Could not process the file", variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="bg-[#1C2128] border border-amber-500/30 rounded-xl p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-[#E6EDF3] truncate">{result.scriptName}</span>
            <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
              Manual
            </span>
            <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
              status === "completed"
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-[#30363D] text-[#7D8590]"
            }`}>
              {status === "completed" ? "Completed" : "Awaiting Upload"}
            </span>
          </div>
          <p className="text-[10px] text-[#484F58] mt-0.5">Run result #{result.runResultId}</p>
        </div>
        <span className="flex-shrink-0 text-[10px] text-[#484F58]">#{result.runOrder + 1}</span>
      </div>

      {status !== "completed" && result.reused && result.packageCreatedAt && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <p className="text-[10px] text-amber-300 leading-snug">
            <span className="font-semibold">Existing package reused</span> — originally created{" "}
            {new Date(result.packageCreatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
            The script and upload link are unchanged.
          </p>
        </div>
      )}

      {status !== "completed" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              onClick={handleDownloadPs1}
              disabled={!result.psContent}
              className="flex items-center gap-1.5 text-[10px] font-semibold text-[#0078D4] border border-[#0078D4]/30 bg-[#0078D4]/10 hover:bg-[#0078D4]/20 disabled:opacity-40 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download .ps1
            </button>
            <button
              onClick={handleDownloadInstructions}
              disabled={!result.instructions}
              className="flex items-center gap-1.5 text-[10px] font-semibold text-[#7D8590] border border-[#30363D] bg-[#161B22] hover:bg-[#1C2128] disabled:opacity-40 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Instructions
            </button>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer w-fit">
            {uploading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
                </svg>
                Upload Results (JSON)
              </>
            )}
            <input type="file" accept=".json,application/json" className="hidden" onChange={e => void handleFileUpload(e)} disabled={uploading} />
          </label>
          <p className="text-[10px] text-[#484F58]">Run the .ps1 script locally, then upload the JSON output for AI analysis</p>
        </div>
      )}

      {status === "completed" && uploadedFindings.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Findings</p>
          {uploadedFindings.slice(0, 3).map((f, i) => (
            <p key={i} className="text-[10px] text-[#E6EDF3]/80 leading-relaxed">• {f}</p>
          ))}
          {uploadedFindings.length > 3 && (
            <p className="text-[10px] text-[#484F58]">+{uploadedFindings.length - 3} more</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Automated Script Result Card ───────────────────────────────────────────────

function AutomatedScriptResultCard({ result }: { result: PackageRunScriptResult }) {
  const statusCfg = {
    completed: { cls: "bg-emerald-500/20 text-emerald-400", label: "Completed" },
    failed: { cls: "bg-red-500/20 text-red-400", label: "Failed" },
    running: { cls: "bg-yellow-500/20 text-yellow-400 animate-pulse", label: "Running" },
  }[result.status] ?? { cls: "bg-[#30363D] text-[#7D8590]", label: result.status };

  return (
    <div className="bg-[#1C2128] border border-[#30363D] rounded-xl p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-xs font-semibold text-[#E6EDF3] truncate">{result.scriptName}</span>
          <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/20">
            Auto
          </span>
          <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${statusCfg.cls}`}>
            {statusCfg.label}
          </span>
        </div>
        <span className="flex-shrink-0 text-[10px] text-[#484F58]">#{result.runOrder + 1}</span>
      </div>
      {result.findings.length > 0 && (
        <div>
          {result.findings.slice(0, 2).map((f, i) => (
            <p key={i} className="text-[10px] text-[#E6EDF3]/70 leading-relaxed">• {f}</p>
          ))}
          {result.findings.length > 2 && (
            <p className="text-[10px] text-[#484F58]">+{result.findings.length - 2} more findings</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Run Package Card ──────────────────────────────────────────────────────────

function RunPackageCard({
  packageId,
  packageName,
  scriptCount,
  onRunComplete,
}: {
  packageId: number;
  packageName: string;
  scriptCount: number;
  onRunComplete: () => void;
}) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [clients, setClients] = useState<ClientWithCred[]>([]);
  const [loadingCreds, setLoadingCreds] = useState(true);
  const [selectedClientId, setSelectedClientId] = useState<number | "">("");
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<PackageRunResult | null>(null);

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
    setRunResult(null);
    try {
      const body: Record<string, unknown> = { packageId, credentialId: selectedClient.credential.id, customerId: selectedClient.id };
      const res = await fetchWithAuth("/api/admin/run-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as PackageRunResult & { error?: string };
      if (!res.ok) {
        toast({ title: (data as unknown as { error?: string }).error ?? "Package run failed", variant: "destructive" });
      } else {
        setRunResult(data);
        const automated = data.completedCount ?? 0;
        const failed = data.failedCount ?? 0;
        const manual = data.awaitingUploadCount ?? 0;
        const parts = [];
        if (automated > 0) parts.push(`${automated} completed`);
        if (failed > 0) parts.push(`${failed} failed`);
        if (manual > 0) parts.push(`${manual} awaiting manual upload`);
        toast({
          title: manual > 0 ? "Package run started — manual scripts need action" : "Package run complete",
          description: parts.join(", "),
        });
        onRunComplete();
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the server", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const handleManualUploaded = (runResultId: number) => {
    setRunResult(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        results: prev.results.map(r =>
          r.runResultId === runResultId ? { ...r, status: "completed" } : r
        ),
        completedCount: prev.completedCount + 1,
        awaitingUploadCount: (prev.awaitingUploadCount ?? 1) - 1,
      };
    });
  };

  return (
    <div className="bg-[#0D1117] border border-[#0078D4]/25 rounded-xl p-4 mt-4 space-y-4">
      <div>
        <p className="text-xs font-bold text-[#E6EDF3] mb-1">Run Package</p>
        <p className="text-[10px] text-[#7D8590]">
          Execute all {scriptCount} script{scriptCount !== 1 ? "s" : ""} in <span className="text-[#E6EDF3] font-medium">{packageName}</span> in order against a selected client.
        </p>
      </div>

      {loadingCreds ? (
        <div className="h-9 bg-[#1C2128] rounded-lg animate-pulse" />
      ) : (
        <div>
          <label className={labelCls}>Client</label>
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
        </div>
      )}

      {selectedClient?.credential && (
        <div className="text-[10px] text-[#7D8590] font-mono bg-[#1C2128] border border-[#30363D] rounded-lg px-3 py-2">
          <span className="font-sans font-semibold text-[#484F58] mr-1">Tenant:</span>{selectedClient.credential.tenantId}
          <span className="mx-2">·</span>
          <span className="font-sans font-semibold text-[#484F58] mr-1">App:</span>{selectedClient.credential.clientId}
          <span className="mx-2">·</span>
          <span className={`font-sans font-semibold px-1.5 py-0.5 rounded text-[9px] uppercase ${
            selectedClient.credential.credentialType === "secret"
              ? "bg-[#0078D4]/15 text-[#0078D4]"
              : "bg-purple-500/15 text-purple-400"
          }`}>{selectedClient.credential.credentialType}</span>
        </div>
      )}

      <button
        onClick={() => void handleRun()}
        disabled={!selectedClientId || running || scriptCount === 0}
        className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#006CBE] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors w-full justify-center"
      >
        {running ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Executing scripts in order…
          </>
        ) : (
          <>
            <TerminalSquare className="w-4 h-4" />
            Run Package
          </>
        )}
      </button>
      {scriptCount === 0 && (
        <p className="text-[10px] text-amber-400 text-center">Add scripts to this package before running</p>
      )}

      {/* Per-script result cards */}
      {runResult && runResult.results.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590]">Script Results</p>
            <div className="flex items-center gap-2">
              {runResult.completedCount > 0 && (
                <span className="text-[9px] font-semibold text-emerald-400">{runResult.completedCount} completed</span>
              )}
              {runResult.failedCount > 0 && (
                <span className="text-[9px] font-semibold text-red-400">{runResult.failedCount} failed</span>
              )}
              {(runResult.awaitingUploadCount ?? 0) > 0 && (
                <span className="text-[9px] font-semibold text-amber-400">{runResult.awaitingUploadCount} awaiting upload</span>
              )}
            </div>
          </div>
          {runResult.results.map(r => (
            r.executionMode === "manual"
              ? <ManualScriptResultCard key={r.runResultId} result={r} onUploaded={handleManualUploaded} />
              : <AutomatedScriptResultCard key={r.runResultId} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Package Assignments Tab ────────────────────────────────────────────────────

function PackageAssignmentsTab({ allScripts }: { allScripts: Script[] }) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [packages, setPackages] = useState<Service[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<number | "">("");
  const [packageScripts, setPackageScripts] = useState<PackageScript[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [loadingPkgScripts, setLoadingPkgScripts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addScriptId, setAddScriptId] = useState<number | "">("");
  const [runCount, setRunCount] = useState(0);

  useEffect(() => {
    fetchWithAuth("/api/admin/services")
      .then(r => r.json() as Promise<Service[]>)
      .then(d => setPackages(d))
      .catch(() => {})
      .finally(() => setLoadingPackages(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPackageScripts = useCallback(async (pkgId: number) => {
    setLoadingPkgScripts(true);
    try {
      const res = await fetchWithAuth(`/api/admin/package-scripts?packageId=${pkgId}`);
      const data = await res.json() as PackageScript[];
      setPackageScripts(data);
    } catch {
      setPackageScripts([]);
    } finally {
      setLoadingPkgScripts(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (selectedPackageId) void loadPackageScripts(selectedPackageId);
    else setPackageScripts([]);
  }, [selectedPackageId, loadPackageScripts]);

  const selectedPackage = packages.find(p => p.id === selectedPackageId);

  const handleAddScript = async () => {
    if (!selectedPackageId || !addScriptId) return;
    const nextOrder = packageScripts.length > 0
      ? Math.max(...packageScripts.map(s => s.runOrder)) + 1
      : 0;
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/admin/package-scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: selectedPackageId, scriptId: addScriptId, runOrder: nextOrder }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to add script", variant: "destructive" });
        return;
      }
      await loadPackageScripts(selectedPackageId);
      setAddScriptId("");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveScript = async (mappingId: number) => {
    if (!selectedPackageId) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/package-scripts/${mappingId}`, { method: "DELETE" });
      if (!res.ok) {
        toast({ title: "Failed to remove script", variant: "destructive" });
        return;
      }
      await loadPackageScripts(selectedPackageId);
    } finally {
      setSaving(false);
    }
  };

  const handleMoveScript = async (idx: number, dir: -1 | 1) => {
    const ordered = [...packageScripts];
    const next = idx + dir;
    if (next < 0 || next >= ordered.length) return;
    // Swap the two entries in the local array, then send the full ordered list
    // to the bulk-reorder endpoint so the unique (packageId, runOrder) constraint
    // can't fire mid-swap.
    [ordered[idx], ordered[next]] = [ordered[next], ordered[idx]];
    const orderedIds = ordered.map(ps => ps.id);
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/admin/package-scripts/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: selectedPackageId, orderedIds }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to reorder scripts", variant: "destructive" });
        return;
      }
      await loadPackageScripts(selectedPackageId as number);
    } finally {
      setSaving(false);
    }
  };

  const assignedIds = new Set(packageScripts.map(s => s.scriptId));
  const availableScripts = allScripts.filter(s => !assignedIds.has(s.id));

  return (
    <div className="space-y-4">
      {/* Package picker */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
        <label className={labelCls}>Select a Quick Win Package</label>
        {loadingPackages ? (
          <div className="h-9 bg-[#1C2128] rounded-lg animate-pulse" />
        ) : (
          <select
            className={inputCls}
            value={selectedPackageId}
            onChange={e => setSelectedPackageId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Choose a package…</option>
            {packages.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {selectedPackageId && selectedPackage && (
        <>
          {/* Scripts list */}
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-[#E6EDF3]">
                Scripts in {selectedPackage.name}
                <span className="ml-2 text-[#0078D4] font-normal">({packageScripts.length})</span>
              </p>
              {saving && <Loader2 className="w-4 h-4 animate-spin text-[#0078D4]" />}
            </div>

            {loadingPkgScripts ? (
              <div className="space-y-2">
                {[1, 2].map(i => <div key={i} className="h-12 bg-[#1C2128] rounded-lg animate-pulse" />)}
              </div>
            ) : packageScripts.length === 0 ? (
              <p className="text-sm text-[#484F58] italic py-4 text-center">
                No scripts assigned to this package yet
              </p>
            ) : (
              <div className="space-y-2 mb-4">
                {packageScripts.map((ps, idx) => (
                  <div
                    key={ps.id}
                    className="flex items-center gap-2 bg-[#1C2128] border border-[#30363D] rounded-lg px-3 py-2.5"
                  >
                    <div className="flex flex-col gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => void handleMoveScript(idx, -1)}
                        disabled={idx === 0 || saving}
                        className="text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-30 transition-colors"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => void handleMoveScript(idx, 1)}
                        disabled={idx === packageScripts.length - 1 || saving}
                        className="text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-30 transition-colors"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="w-5 h-5 rounded-full bg-[#0078D4]/15 text-[#0078D4] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#E6EDF3] truncate">{ps.script.name}</p>
                      <p className="text-[10px] text-[#484F58] font-mono truncate">{ps.script.runbookName}</p>
                    </div>
                    <span className="text-[10px] text-[#7D8590] bg-[#0D1117] border border-[#30363D] rounded px-1.5 py-0.5 flex-shrink-0">
                      {ps.script.appRegPermissions.length} perm{ps.script.appRegPermissions.length !== 1 ? "s" : ""}
                    </span>
                    <button
                      onClick={() => void handleRemoveScript(ps.id)}
                      disabled={saving}
                      className="text-red-400 hover:text-red-300 transition-colors disabled:opacity-30 flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add script */}
            <div className="flex gap-2 border-t border-[#30363D] pt-3">
              <select
                className={`${inputCls} flex-1`}
                value={addScriptId}
                onChange={e => setAddScriptId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Add a script…</option>
                {availableScripts.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                onClick={() => void handleAddScript()}
                disabled={!addScriptId || saving}
                className="flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#006CBE] disabled:opacity-50 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors flex-shrink-0"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>

          {/* App Reg Requirements */}
          <AppRegRequirementsPanel packageId={selectedPackageId as number} />

          {/* Run Package */}
          <RunPackageCard
            packageId={selectedPackageId as number}
            packageName={selectedPackage.name}
            scriptCount={packageScripts.length}
            onRunComplete={() => setRunCount(c => c + 1)}
          />
          {runCount > 0 && (
            <p className="text-[10px] text-green-400 text-center">
              ✓ {runCount} package run{runCount !== 1 ? "s" : ""} triggered — check Run Results for details
            </p>
          )}
        </>
      )}
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
      const body: Record<string, unknown> = { scriptId: script.id, credentialId: selectedClient.credential.id, customerId: selectedClient.id };
      const res = await fetchWithAuth("/api/admin/run-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { status?: string; findings?: string[]; error?: string };
      if (!res.ok) {
        toast({ title: data.error ?? "Script run failed", variant: "destructive" });
      } else {
        toast({
          title: `Script run ${data.status ?? "complete"}`,
          description: data.findings?.length
            ? `${data.findings.length} finding${data.findings.length !== 1 ? "s" : ""} — see Run Results`
            : "No findings — see Run Results for details",
        });
        setDone(true);
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the server", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D]">
          <div>
            <p className="text-sm font-bold text-[#E6EDF3]">Run Script</p>
            <p className="text-[10px] text-[#7D8590] font-mono mt-0.5 truncate max-w-[300px]">{script.name}</p>
          </div>
          <button onClick={onClose} className="text-[#484F58] hover:text-[#E6EDF3] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {done ? (
            <div className="text-center py-4">
              <p className="text-green-400 text-sm font-semibold mb-1">Run complete</p>
              <p className="text-[10px] text-[#7D8590]">Check the Run Results page for AI findings and output</p>
            </div>
          ) : (
            <>
              <div>
                <label className={labelCls}>Client</label>
                {loadingCreds ? (
                  <div className="h-9 bg-[#1C2128] rounded-lg animate-pulse" />
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
                  <span className="mx-2">·</span>
                  <span className="font-sans font-semibold text-[#484F58] mr-1">App:</span>{selectedClient.credential.clientId}
                </div>
              )}

              <p className="text-[10px] text-[#484F58]">
                Runbook: <span className="font-mono text-[#7D8590]">{script.runbookName}</span>
              </p>
            </>
          )}
        </div>

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
              disabled={!selectedClientId || running}
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
        toast({ title: err.error ?? "Failed to create category", variant: "destructive" });
        return;
      }
      setNewName("");
      onChanged();
    } finally {
      setSaving(false);
    }
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
        toast({ title: err.error ?? "Failed to rename category", variant: "destructive" });
        return;
      }
      onChanged();
    } finally {
      setSaving(false);
    }
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
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayOrder: neighbour.displayOrder }),
        }),
        fetchWithAuth(`/api/admin/script-categories/${neighbour.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayOrder: cat.displayOrder }),
        }),
      ]);
      if (!r1.ok || !r2.ok) {
        toast({ title: "Failed to reorder categories", variant: "destructive" });
        return;
      }
      onChanged();
    } catch {
      toast({ title: "Failed to reorder categories", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/script-categories/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to delete category", variant: "destructive" });
        return;
      }
      setDeleteTarget(null);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#1C2128] transition-colors"
        >
          <div className="flex items-center gap-2">
            <Tag className="w-3.5 h-3.5 text-[#0078D4]" />
            <span className="text-xs font-bold text-[#E6EDF3]">Manage Categories</span>
            <span className="text-[10px] text-[#7D8590] bg-[#0D1117] border border-[#30363D] rounded px-1.5 py-0.5">{categories.length}</span>
          </div>
          <ChevronRight className={`w-4 h-4 text-[#484F58] transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        </button>

        {open && (
          <div className="border-t border-[#30363D] px-4 pb-4 pt-3 space-y-3">
            {sorted.length === 0 ? (
              <p className="text-xs text-[#484F58] italic text-center py-2">No categories yet — add one below</p>
            ) : (
              <div className="space-y-1">
                {sorted.map((cat, idx) => (
                  <div key={cat.id} className="flex items-center gap-2 bg-[#1C2128] border border-[#30363D] rounded-lg px-2.5 py-2">
                    <div className="flex flex-col gap-0.5 flex-shrink-0">
                      <button onClick={() => void handleMove(cat, -1)} disabled={idx === 0 || saving} className="text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-30 transition-colors">
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button onClick={() => void handleMove(cat, 1)} disabled={idx === sorted.length - 1 || saving} className="text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-30 transition-colors">
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>
                    {editId === cat.id ? (
                      <input
                        autoFocus
                        className="flex-1 min-w-0 text-xs bg-[#0D1117] border border-[#0078D4]/50 rounded px-2 py-1 text-[#E6EDF3] focus:outline-none"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onBlur={() => void handleRename(cat.id)}
                        onKeyDown={e => {
                          if (e.key === "Enter") void handleRename(cat.id);
                          if (e.key === "Escape") setEditId(null);
                        }}
                      />
                    ) : (
                      <span
                        className="flex-1 min-w-0 text-xs text-[#E6EDF3] cursor-text hover:text-white truncate"
                        onDoubleClick={() => { setEditId(cat.id); setEditName(cat.name); }}
                        title="Double-click to rename"
                      >
                        {cat.name}
                      </span>
                    )}
                    <button
                      onClick={() => { setEditId(cat.id); setEditName(cat.name); }}
                      className="text-[#484F58] hover:text-[#0078D4] transition-colors flex-shrink-0"
                      title="Rename"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(cat)}
                      className="text-[#484F58] hover:text-red-400 transition-colors flex-shrink-0"
                      title="Delete category"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 border-t border-[#30363D] pt-3">
              <input
                type="text"
                placeholder="New category name…"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void handleCreate(); }}
                className={`${inputCls} flex-1`}
              />
              <button
                onClick={() => void handleCreate()}
                disabled={!newName.trim() || saving}
                className="flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#006CBE] disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors flex-shrink-0"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-[#161B22] border border-[#30363D] text-[#E6EDF3]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription className="text-[#7D8590]">
              Delete <strong className="text-[#E6EDF3]">{deleteTarget?.name}</strong>? Scripts in this category will become uncategorised — they are not deleted.
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

// ── Script Row (shared between flat + grouped views) ──────────────────────────

function ScriptRow({
  s,
  onEdit,
  onDelete,
  onRun,
}: {
  s: Script;
  onEdit: (s: Script) => void;
  onDelete: (s: Script) => void;
  onRun: (s: Script) => void;
}) {
  return (
    <tr className="hover:bg-[#1C2128] transition-colors group">
      <td className="px-4 py-3">
        <p className="font-semibold text-[#E6EDF3] truncate max-w-xs">{s.name}</p>
        {s.description && (
          <p className="text-[10px] text-[#7D8590] mt-0.5 truncate max-w-xs">{s.description}</p>
        )}
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <span className="font-mono text-xs text-[#7D8590]">{s.runbookName}</span>
      </td>
      <td className="px-4 py-3 hidden lg:table-cell">
        <span className="text-xs text-[#7D8590]">
          {s.appRegPermissions.length > 0
            ? `${s.appRegPermissions.length} permission${s.appRegPermissions.length !== 1 ? "s" : ""}`
            : <span className="text-[#484F58] italic">None</span>}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onRun(s)} className="p-1.5 text-[#7D8590] hover:text-green-400 hover:bg-green-400/10 rounded transition-colors" title="Run script against a client">
            <Play className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onEdit(s)} className="p-1.5 text-[#7D8590] hover:text-[#0078D4] hover:bg-[#0078D4]/10 rounded transition-colors" title="Edit">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(s)} className="p-1.5 text-[#7D8590] hover:text-red-400 hover:bg-red-400/10 rounded transition-colors" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Script Table (renders rows inside a styled table container) ───────────────

function ScriptTable({
  scripts,
  onEdit,
  onDelete,
  onRun,
}: {
  scripts: Script[];
  onEdit: (s: Script) => void;
  onDelete: (s: Script) => void;
  onRun: (s: Script) => void;
}) {
  return (
    <div className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#30363D]">
            <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#7D8590]">Script</th>
            <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#7D8590] hidden md:table-cell">Runbook Name</th>
            <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#7D8590] hidden lg:table-cell">Permissions</th>
            <th className="px-4 py-2.5 w-24" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[#21262D]">
          {scripts.map(s => (
            <ScriptRow key={s.id} s={s} onEdit={onEdit} onDelete={onDelete} onRun={onRun} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Script Catalog Tab ────────────────────────────────────────────────────────

const UNCATEGORISED_KEY = -1;

function ScriptCatalogTab({
  scripts,
  loading,
  categories,
  onEdit,
  onDeleted,
  onCategoriesChanged,
}: {
  scripts: Script[];
  loading: boolean;
  categories: Category[];
  onEdit: (s: Script) => void;
  onDeleted: (id: number) => void;
  onCategoriesChanged: () => void;
}) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<Script | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [runTarget, setRunTarget] = useState<Script | null>(null);

  const sortedCategories = [...categories].sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

  const SESSION_KEY = "m365-catalog-open-sections";

  // Two-phase approach:
  // Phase "before": waiting for first non-empty categories load from API.
  // Phase "done": initial load complete; only auto-open truly new category IDs.
  const initPhaseRef = useRef<"before" | "done">("before");
  // Track IDs seen in the initial categories load — so later reloads don't re-open closed sections.
  const initialCategoryIdsRef = useRef<Set<number>>(new Set<number>());

  const [openSections, setOpenSections] = useState<Set<number>>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) return new Set<number>(JSON.parse(saved) as number[]);
    } catch { /* ignore */ }
    // No session yet — start with just UNCATEGORISED open; initial load will add the rest.
    return new Set<number>([UNCATEGORISED_KEY]);
  });

  // Persist to sessionStorage immediately on every change
  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify([...openSections]));
    } catch { /* ignore */ }
  }, [openSections]);

  // Manage which sections are open when categories change
  useEffect(() => {
    if (categories.length === 0) return; // Wait for API to load

    if (initPhaseRef.current === "before") {
      // First non-empty load from API
      initPhaseRef.current = "done";
      initialCategoryIdsRef.current = new Set(categories.map(c => c.id));

      // Only auto-open if there's no saved session yet (true first visit)
      let hasSaved = false;
      try { hasSaved = !!sessionStorage.getItem(SESSION_KEY); } catch { /* ignore */ }
      if (!hasSaved) {
        setOpenSections(new Set([...categories.map(c => c.id), UNCATEGORISED_KEY]));
      }
      return;
    }

    // Normal phase: only auto-open IDs that weren't in the initial load (genuinely new)
    const newIds = categories
      .map(c => c.id)
      .filter(id => !initialCategoryIdsRef.current.has(id));
    // Track new IDs so they aren't considered "new" on the next reload
    for (const id of newIds) initialCategoryIdsRef.current.add(id);

    if (newIds.length > 0) {
      setOpenSections(prev => {
        const next = new Set(prev);
        for (const id of newIds) next.add(id);
        return next;
      });
    }
  }, [categories]);

  const toggleSection = (id: number) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
      onDeleted(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => <div key={i} className="h-14 bg-[#161B22] rounded-lg animate-pulse" />)}
    </div>
  );

  // Build category → scripts map. Scripts with no categories → uncategorised.
  const catMap = new Map<number, Script[]>();
  const uncategorised: Script[] = [];
  for (const s of scripts) {
    if (!s.categoryIds || s.categoryIds.length === 0) {
      uncategorised.push(s);
    } else {
      for (const cid of s.categoryIds) {
        if (!catMap.has(cid)) catMap.set(cid, []);
        catMap.get(cid)!.push(s);
      }
    }
  }

  const hasCategorised = catMap.size > 0;
  const showUncategorised = uncategorised.length > 0 || (!hasCategorised && scripts.length === 0);
  const useFlatView = categories.length === 0;

  return (
    <>
      {/* Category manager collapsible panel */}
      <CategoryManagerPanel categories={categories} onChanged={onCategoriesChanged} />

      {scripts.length === 0 ? (
        <div className="text-center py-16">
          <TerminalSquare className="w-10 h-10 text-[#30363D] mx-auto mb-3" />
          <p className="text-[#7D8590] text-sm">No scripts in the catalog yet</p>
          <p className="text-[#484F58] text-xs mt-1">Create your first script to get started</p>
        </div>
      ) : useFlatView ? (
        /* No categories — flat table */
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
          <ScriptTable scripts={scripts} onEdit={onEdit} onDelete={s => setDeleteTarget(s)} onRun={s => setRunTarget(s)} />
        </div>
      ) : (
        /* Grouped accordion view */
        <div className="space-y-2">
          {sortedCategories.map(cat => {
            const catScripts = catMap.get(cat.id) ?? [];
            const isOpen = openSections.has(cat.id);
            return (
              <div key={cat.id} className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleSection(cat.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1C2128] transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <ChevronRight className={`w-4 h-4 text-[#484F58] transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`} />
                    <Tag className="w-3.5 h-3.5 text-[#0078D4]" />
                    <span className="text-sm font-semibold text-[#E6EDF3]">{cat.name}</span>
                    <span className="text-[10px] text-[#7D8590] bg-[#0D1117] border border-[#30363D] rounded px-1.5 py-0.5">
                      {catScripts.length}
                    </span>
                  </div>
                </button>
                {isOpen && (
                  catScripts.length === 0 ? (
                    <div className="border-t border-[#30363D] px-4 py-6 text-center">
                      <p className="text-xs text-[#484F58] italic">No scripts assigned to this category</p>
                    </div>
                  ) : (
                    <div className="border-t border-[#30363D]">
                      <ScriptTable scripts={catScripts} onEdit={onEdit} onDelete={s => setDeleteTarget(s)} onRun={s => setRunTarget(s)} />
                    </div>
                  )
                )}
              </div>
            );
          })}

          {/* Uncategorised section — only shown when there are uncategorised scripts */}
          {showUncategorised && uncategorised.length > 0 && (
            <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
              <button
                onClick={() => toggleSection(UNCATEGORISED_KEY)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1C2128] transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <ChevronRight className={`w-4 h-4 text-[#484F58] transition-transform duration-150 ${openSections.has(UNCATEGORISED_KEY) ? "rotate-90" : ""}`} />
                  <span className="text-sm font-semibold text-[#7D8590]">Uncategorised</span>
                  <span className="text-[10px] text-[#484F58] bg-[#0D1117] border border-[#30363D] rounded px-1.5 py-0.5">
                    {uncategorised.length}
                  </span>
                </div>
              </button>
              {openSections.has(UNCATEGORISED_KEY) && (
                <div className="border-t border-[#30363D]">
                  <ScriptTable scripts={uncategorised} onEdit={onEdit} onDelete={s => setDeleteTarget(s)} onRun={s => setRunTarget(s)} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-[#161B22] border border-[#30363D] text-[#E6EDF3]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Script</AlertDialogTitle>
            <AlertDialogDescription className="text-[#7D8590]">
              Delete <strong className="text-[#E6EDF3]">{deleteTarget?.name}</strong>? This will remove it from all packages and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-[#1C2128] border-[#30363D] text-[#E6EDF3] hover:bg-[#30363D]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {runTarget && (
        <RunScriptModal script={runTarget} onClose={() => setRunTarget(null)} />
      )}
    </>
  );
}

// ── Page Root ─────────────────────────────────────────────────────────────────

type Tab = "catalog" | "packages";

export default function M365ScriptCatalogPage() {
  const { fetchWithAuth } = useAuth();
  const [tab, setTab] = useState<Tab>("catalog");
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editScript, setEditScript] = useState<Script | null>(null);

  const loadScripts = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/scripts");
      const data = await res.json() as Script[];
      setScripts(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/script-categories");
      const data = await res.json() as Category[];
      setCategories(data);
    } catch {
      // ignore
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadScripts();
    void loadCategories();
  }, [loadScripts, loadCategories]);

  const handleEdit = (s: Script) => {
    setEditScript(s);
    setShowForm(true);
  };

  const handleNew = () => {
    setEditScript(null);
    setShowForm(true);
  };

  const handleSaved = (saved: Script) => {
    setScripts(prev => {
      const exists = prev.find(s => s.id === saved.id);
      return exists ? prev.map(s => s.id === saved.id ? saved : s) : [...prev, saved];
    });
    setShowForm(false);
    setEditScript(null);
  };

  const handleDeleted = (id: number) => {
    setScripts(prev => prev.filter(s => s.id !== id));
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">M365 Script Catalog</h1>
          <p className="text-sm text-[#7D8590] mt-0.5">Manage the Command Center script catalog and Quick Win package assignments</p>
        </div>
        {tab === "catalog" && (
          <button
            onClick={handleNew}
            className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#006CBE] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Script
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#30363D]">
        {([
          { id: "catalog" as Tab, label: "Script Catalog", count: scripts.length },
          { id: "packages" as Tab, label: "Package Assignments" },
        ] as Array<{ id: Tab; label: string; count?: number }>).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              tab === t.id
                ? "text-[#0078D4] border-[#0078D4]"
                : "text-[#7D8590] border-transparent hover:text-[#E6EDF3]"
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="text-[10px] bg-[#30363D] text-[#7D8590] px-1.5 py-0.5 rounded-full font-bold">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "catalog" && (
        <ScriptCatalogTab
          scripts={scripts}
          loading={loading}
          categories={categories}
          onEdit={handleEdit}
          onDeleted={handleDeleted}
          onCategoriesChanged={() => { void loadCategories(); void loadScripts(); }}
        />
      )}
      {tab === "packages" && (
        <PackageAssignmentsTab allScripts={scripts} />
      )}

      {/* Create/Edit slide-over */}
      {showForm && (
        <ScriptFormModal
          script={editScript}
          categories={categories}
          onClose={() => { setShowForm(false); setEditScript(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
