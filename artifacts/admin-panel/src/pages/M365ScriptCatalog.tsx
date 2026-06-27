import { useState, useEffect, useCallback } from "react";
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
import { Loader2, Plus, Trash2, Pencil, ChevronUp, ChevronDown, Copy, Check, TerminalSquare, X, Play } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AppRegPermission {
  permission: string;
  type: "Application" | "Delegated";
  reason: string;
}

interface Script {
  id: number;
  name: string;
  description: string | null;
  runbookName: string;
  appRegPermissions: AppRegPermission[];
  aiInstructions: string | null;
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
  };
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

// ── Script Form Modal ─────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: "",
  description: "",
  runbookName: "",
  appRegPermissions: [] as AppRegPermission[],
  aiInstructions: "",
};

function ScriptFormModal({
  script,
  onClose,
  onSaved,
}: {
  script: Script | null;
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
        }
      : { ...EMPTY_FORM, appRegPermissions: [] as AppRegPermission[] }
  );
  const [saving, setSaving] = useState(false);

  const addPerm = () =>
    setForm(f => ({ ...f, appRegPermissions: [...f.appRegPermissions, { permission: "", type: "Application", reason: "" }] }));

  const updatePerm = (i: number, p: AppRegPermission) =>
    setForm(f => ({ ...f, appRegPermissions: f.appRegPermissions.map((x, idx) => (idx === i ? p : x)) }));

  const removePerm = (i: number) =>
    setForm(f => ({ ...f, appRegPermissions: f.appRegPermissions.filter((_, idx) => idx !== i) }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.runbookName.trim()) {
      toast({ title: "Name and Runbook Name are required", variant: "destructive" });
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
          appRegPermissions: form.appRegPermissions.filter(p => p.permission.trim()),
          aiInstructions: form.aiInstructions.trim() || undefined,
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
            <label className={labelCls}>Azure Automation Runbook Name *</label>
            <input
              type="text"
              placeholder="e.g. Check-MFAStatus"
              value={form.runbookName}
              onChange={e => setForm(f => ({ ...f, runbookName: e.target.value }))}
              className={`${inputCls} font-mono`}
            />
            <p className="text-[10px] text-[#484F58] mt-1">Must match exactly the runbook name in Azure Automation</p>
          </div>

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
            disabled={saving}
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
  const [credentials, setCredentials] = useState<AzureCredential[]>([]);
  const [loadingCreds, setLoadingCreds] = useState(true);
  const [selectedCredId, setSelectedCredId] = useState<number | "">("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetchWithAuth("/api/admin/azure-credentials")
      .then(r => r.json() as Promise<AzureCredential[]>)
      .then(d => setCredentials(d))
      .catch(() => {})
      .finally(() => setLoadingCreds(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedCred = credentials.find(c => c.id === selectedCredId);

  const handleRun = async () => {
    if (!selectedCredId) return;
    setRunning(true);
    try {
      const body: Record<string, unknown> = { packageId, credentialId: selectedCredId };
      if (selectedCred?.clientUserId) body.customerId = selectedCred.clientUserId;
      const res = await fetchWithAuth("/api/admin/run-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { completedCount?: number; failedCount?: number; error?: string };
      if (!res.ok) {
        toast({ title: data.error ?? "Package run failed", variant: "destructive" });
      } else {
        toast({
          title: `Package run complete`,
          description: `${data.completedCount ?? 0} completed, ${data.failedCount ?? 0} failed`,
        });
        onRunComplete();
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the server", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-[#0D1117] border border-[#0078D4]/25 rounded-xl p-4 mt-4">
      <p className="text-xs font-bold text-[#E6EDF3] mb-1">Run Package</p>
      <p className="text-[10px] text-[#7D8590] mb-3">
        Execute all {scriptCount} script{scriptCount !== 1 ? "s" : ""} in <span className="text-[#E6EDF3] font-medium">{packageName}</span> in order against a selected client.
      </p>

      {loadingCreds ? (
        <div className="h-9 bg-[#1C2128] rounded-lg animate-pulse mb-3" />
      ) : (
        <div className="mb-3">
          <label className={labelCls}>Client</label>
          <select
            className={inputCls}
            value={selectedCredId}
            onChange={e => setSelectedCredId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Select a client…</option>
            {credentials.map(c => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </select>
        </div>
      )}

      {selectedCred && (
        <div className="mb-3 text-[10px] text-[#7D8590] font-mono bg-[#1C2128] border border-[#30363D] rounded-lg px-3 py-2">
          <span className="font-sans font-semibold text-[#484F58] mr-1">Tenant:</span>{selectedCred.tenantId}
          <span className="mx-2">·</span>
          <span className="font-sans font-semibold text-[#484F58] mr-1">App:</span>{selectedCred.clientId}
          <span className="mx-2">·</span>
          <span className={`font-sans font-semibold px-1.5 py-0.5 rounded text-[9px] uppercase ${
            selectedCred.credentialType === "secret"
              ? "bg-[#0078D4]/15 text-[#0078D4]"
              : "bg-purple-500/15 text-purple-400"
          }`}>{selectedCred.credentialType}</span>
        </div>
      )}

      <button
        onClick={() => void handleRun()}
        disabled={!selectedCredId || running || scriptCount === 0}
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
        <p className="text-[10px] text-amber-400 mt-2 text-center">Add scripts to this package before running</p>
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
  const [credentials, setCredentials] = useState<AzureCredential[]>([]);
  const [loadingCreds, setLoadingCreds] = useState(true);
  const [selectedCredId, setSelectedCredId] = useState<number | "">("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchWithAuth("/api/admin/azure-credentials")
      .then(r => r.json() as Promise<AzureCredential[]>)
      .then(d => setCredentials(d))
      .catch(() => {})
      .finally(() => setLoadingCreds(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedCred = credentials.find(c => c.id === selectedCredId);

  const handleRun = async () => {
    if (!selectedCredId) return;
    setRunning(true);
    try {
      const body: Record<string, unknown> = { scriptId: script.id, credentialId: selectedCredId };
      if (selectedCred?.clientUserId) body.customerId = selectedCred.clientUserId;
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
                    value={selectedCredId}
                    onChange={e => setSelectedCredId(e.target.value ? Number(e.target.value) : "")}
                  >
                    <option value="">Select a client…</option>
                    {credentials.map(c => (
                      <option key={c.id} value={c.id}>{c.displayName}</option>
                    ))}
                  </select>
                )}
              </div>

              {selectedCred && (
                <div className="text-[10px] text-[#7D8590] font-mono bg-[#1C2128] border border-[#30363D] rounded-lg px-3 py-2">
                  <span className="font-sans font-semibold text-[#484F58] mr-1">Tenant:</span>{selectedCred.tenantId}
                  <span className="mx-2">·</span>
                  <span className="font-sans font-semibold text-[#484F58] mr-1">App:</span>{selectedCred.clientId}
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
              disabled={!selectedCredId || running}
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

// ── Script Catalog Tab ────────────────────────────────────────────────────────

function ScriptCatalogTab({
  scripts,
  loading,
  onEdit,
  onDeleted,
}: {
  scripts: Script[];
  loading: boolean;
  onEdit: (s: Script) => void;
  onDeleted: (id: number) => void;
}) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<Script | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [runTarget, setRunTarget] = useState<Script | null>(null);

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

  if (scripts.length === 0) return (
    <div className="text-center py-16">
      <TerminalSquare className="w-10 h-10 text-[#30363D] mx-auto mb-3" />
      <p className="text-[#7D8590] text-sm">No scripts in the catalog yet</p>
      <p className="text-[#484F58] text-xs mt-1">Create your first script to get started</p>
    </div>
  );

  return (
    <>
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#30363D]">
              <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#7D8590]">Script</th>
              <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#7D8590] hidden md:table-cell">Runbook Name</th>
              <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#7D8590] hidden lg:table-cell">Permissions</th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#21262D]">
            {scripts.map(s => (
              <tr key={s.id} className="hover:bg-[#1C2128] transition-colors group">
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
                    <button
                      onClick={() => setRunTarget(s)}
                      className="p-1.5 text-[#7D8590] hover:text-green-400 hover:bg-green-400/10 rounded transition-colors"
                      title="Run script against a client"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onEdit(s)}
                      className="p-1.5 text-[#7D8590] hover:text-[#0078D4] hover:bg-[#0078D4]/10 rounded transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(s)}
                      className="p-1.5 text-[#7D8590] hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

  useEffect(() => { void loadScripts(); }, [loadScripts]);

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
          onEdit={handleEdit}
          onDeleted={handleDeleted}
        />
      )}
      {tab === "packages" && (
        <PackageAssignmentsTab allScripts={scripts} />
      )}

      {/* Create/Edit slide-over */}
      {showForm && (
        <ScriptFormModal
          script={editScript}
          onClose={() => { setShowForm(false); setEditScript(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
