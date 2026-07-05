import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, Check, Circle, Plus, Trash2, Pencil, X, ChevronRight, Download,
  Upload, Save, RotateCcw, Loader2, Play, Eye, Zap, Search, Tag, Clock, FlaskConical, Database,
} from "lucide-react";

interface TenantSignal {
  key: string;
  label: string;
  description: string;
  expectedImpact: string;
  recommendedRules: Array<{ ruleType: string; sourceKey: string; compareValue?: string; rationale: string }>;
  unlocksProjects?: Array<{ id: number; title: string }>;
}

interface SignalRule {
  id: number;
  signalKey: string;
  groupId: number | null;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string | null;
  sortOrder: number;
}

interface SignalGroup {
  id: number;
  signalKey: string;
  logic: "AND" | "OR";
  label: string | null;
  sortOrder: number;
}

interface RuleTraceEntry {
  signalKey: string;
  groupId: number | null;
  ruleId: number;
  result: boolean;
  reason: string;
}

interface SimulationProfile {
  id: number;
  name: string;
  description: string | null;
  profileUpdates: Record<string, unknown>;
  parsedFindings: string[];
  tags: string[];
  lastRunAt: string | null;
  lastRunResult: Array<{ key: string; label: string }> | null;
}

interface Conflict {
  ruleIds: number[];
  description: string;
}

interface ScriptField {
  key: string;
  type: string;
  examples: unknown[];
  seenInNRuns: number;
}

interface Version {
  id: number;
  name: string;
  ruleCount: number;
  createdAt: string;
}

interface HealthData {
  [signalKey: string]: { clientCount: number; totalClients: number };
}

interface ClientWithRuns {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
  runCount: number;
  lastRunAt: string;
}

interface SimProfileRunResult {
  firedSignals: Array<{ key: string; label: string; expectedImpact: string }>;
  ruleTrace: RuleTraceEntry[];
  includedProjects: Array<{ id: number; title: string; priceRange: string | null }>;
  excludedProjects: Array<{ project: { id: number; title: string }; reason: string }>;
}

const RULE_TYPE_OPTIONS = [
  { value: "profile_key_truthy", label: "Is Truthy", color: "bg-green-900/40 text-green-400" },
  { value: "profile_key_falsy", label: "Is Falsy", color: "bg-red-900/40 text-red-400" },
  { value: "profile_key_eq", label: "Equals", color: "bg-blue-900/40 text-blue-400" },
  { value: "profile_key_gt", label: "Greater Than", color: "bg-purple-900/40 text-purple-400" },
  { value: "profile_key_lt", label: "Less Than", color: "bg-yellow-900/40 text-yellow-400" },
  { value: "findings_keyword", label: "Keyword", color: "bg-teal-900/40 text-teal-400" },
];

function ruleTypePill(ruleType: string) {
  const opt = RULE_TYPE_OPTIONS.find(o => o.value === ruleType);
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${opt?.color ?? "bg-[#30363D] text-[#7D8590]"}`}>
      {opt?.label ?? ruleType}
    </span>
  );
}

function needsCompareValue(ruleType: string) {
  return ["profile_key_eq", "profile_key_gt", "profile_key_lt"].includes(ruleType);
}

export default function TenantSignalsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [signals, setSignals] = useState<TenantSignal[]>([]);
  const [rules, setRules] = useState<SignalRule[]>([]);
  const [groups, setGroups] = useState<SignalGroup[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [health, setHealth] = useState<HealthData>({});
  const [versions, setVersions] = useState<Version[]>([]);
  const [scriptFields, setScriptFields] = useState<ScriptField[]>([]);
  const [simProfiles, setSimProfiles] = useState<SimulationProfile[]>([]);

  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"rules" | "docs" | "audit">("rules");
  const [loading, setLoading] = useState(true);

  const [showTestModal, setShowTestModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showDryRunModal, setShowDryRunModal] = useState(false);
  const [showConflictsPanel, setShowConflictsPanel] = useState(false);
  const [showSnapshotsPanel, setShowSnapshotsPanel] = useState(false);
  const [showScriptExplorer, setShowScriptExplorer] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const [testJson, setTestJson] = useState(JSON.stringify({ profileUpdates: {}, parsedFindings: [] }, null, 2));
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<{ firedSignals: Array<{ key: string; label: string; expectedImpact: string }>; ruleTrace: RuleTraceEntry[] } | null>(null);

  const [previewResult, setPreviewResult] = useState<{ firedSignals: Array<{ key: string; label: string; expectedImpact: string }>; included: Array<{ id: number; title: string }>; excluded: Array<{ project: { id: number; title: string }; reason: string }> } | null>(null);
  const [previewRunning, setPreviewRunning] = useState(false);

  const [dryRunClientId, setDryRunClientId] = useState("");
  const [dryRunRunning, setDryRunRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{ firedSignals: Array<{ key: string; label: string }>; includedProjects: Array<{ title: string }>; excludedProjects: Array<{ project: { title: string }; reason: string }>; note: string } | null>(null);

  const [clients, setClients] = useState<Array<{ id: number; name: string | null; email: string; company: string | null }>>([]);
  const [auditLog, setAuditLog] = useState<Array<{ id: number; action: string; signalKey: string | null; ruleId: number | null; note: string | null; createdAt: string }>>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [addRuleForm, setAddRuleForm] = useState({ ruleType: "profile_key_truthy", sourceKey: "", compareValue: "", description: "", groupId: "" });
  const [savingRule, setSavingRule] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editRuleForm, setEditRuleForm] = useState({ ruleType: "", sourceKey: "", compareValue: "", description: "" });
  const [deletingRuleId, setDeletingRuleId] = useState<number | null>(null);

  const [addGroupForm, setAddGroupForm] = useState({ logic: "OR" as "AND" | "OR", label: "" });
  const [savingGroup, setSavingGroup] = useState(false);

  const [snapshotName, setSnapshotName] = useState("");
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  const [importJson, setImportJson] = useState("");
  const [importRunning, setImportRunning] = useState(false);

  const [scriptFieldSearch, setScriptFieldSearch] = useState("");
  const [simProfileSearch, setSimProfileSearch] = useState("");
  const [newProfileForm, setNewProfileForm] = useState({ name: "", description: "", tags: "" });
  const [savingProfile, setSavingProfile] = useState(false);

  const [pageView, setPageView] = useState<"rules" | "simulate">("rules");
  const [clientsWithRuns, setClientsWithRuns] = useState<ClientWithRuns[]>([]);
  const [showFromClientModal, setShowFromClientModal] = useState(false);
  const [fromClientSearch, setFromClientSearch] = useState("");
  const [fromClientId, setFromClientId] = useState("");
  const [fromClientName, setFromClientName] = useState("");
  const [importingFromClient, setImportingFromClient] = useState(false);
  const [profileRunResults, setProfileRunResults] = useState<Record<number, SimProfileRunResult>>({});
  const [runningProfileId, setRunningProfileId] = useState<number | null>(null);
  const [expandedProfileId, setExpandedProfileId] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [signalsRes, rulesRes, conflictsRes, healthRes, versionsRes] = await Promise.all([
        fetchWithAuth("/api/admin/engagement-projects/signals"),
        fetchWithAuth("/api/admin/signal-rules"),
        fetchWithAuth("/api/admin/signal-rules/conflicts"),
        fetchWithAuth("/api/admin/signal-rules/health"),
        fetchWithAuth("/api/admin/signal-rules/versions"),
      ]);

      if (signalsRes.ok) setSignals(await signalsRes.json() as TenantSignal[]);
      if (rulesRes.ok) {
        const data = await rulesRes.json() as { rules: SignalRule[]; groups: SignalGroup[] };
        setRules(data.rules ?? []);
        setGroups(data.groups ?? []);
      }
      if (conflictsRes.ok) {
        const data = await conflictsRes.json() as { conflicts: Conflict[] };
        setConflicts(data.conflicts ?? []);
      }
      if (healthRes.ok) setHealth(await healthRes.json() as HealthData);
      if (versionsRes.ok) setVersions(await versionsRes.json() as Version[]);
    } catch (err) {
      toast({ title: "Failed to load signal data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  const loadSimProfiles = useCallback(async () => {
    const res = await fetchWithAuth("/api/admin/signal-rules/simulation-profiles");
    if (res.ok) setSimProfiles(await res.json() as SimulationProfile[]);
  }, [fetchWithAuth]);

  const loadScriptFields = useCallback(async () => {
    const res = await fetchWithAuth("/api/admin/signal-rules/script-fields");
    if (res.ok) setScriptFields(await res.json() as ScriptField[]);
  }, [fetchWithAuth]);

  const loadClientsWithRuns = useCallback(async () => {
    const res = await fetchWithAuth("/api/admin/signal-rules/clients-with-runs");
    if (res.ok) setClientsWithRuns(await res.json() as ClientWithRuns[]);
  }, [fetchWithAuth]);

  const loadClients = useCallback(async () => {
    const res = await fetchWithAuth("/api/admin/clients/enriched");
    if (res.ok) {
      const data = await res.json() as Array<{ id: number; name: string | null; email: string; company: string | null }>;
      setClients(Array.isArray(data) ? data : []);
    }
  }, [fetchWithAuth]);

  const loadAuditLog = useCallback(async (signalKey?: string) => {
    setAuditLoading(true);
    try {
      const url = signalKey
        ? `/api/admin/signal-rules/audit-log?signalKey=${encodeURIComponent(signalKey)}&limit=50`
        : "/api/admin/signal-rules/audit-log?limit=50";
      const res = await fetchWithAuth(url);
      if (res.ok) {
        const data = await res.json() as { rows: typeof auditLog };
        setAuditLog(data.rows ?? []);
      }
    } finally {
      setAuditLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    if (activeTab === "audit" && selectedSignal) void loadAuditLog(selectedSignal);
  }, [activeTab, selectedSignal, loadAuditLog]);

  const signalRules = (key: string) => rules.filter(r => r.signalKey === key);
  const signalGroups = (key: string) => groups.filter(g => g.signalKey === key);
  const conflictRuleIds = new Set(conflicts.flatMap(c => c.ruleIds));
  const signalConflictCount = (key: string) => conflicts.filter(c =>
    c.ruleIds.some(id => rules.find(r => r.id === id && r.signalKey === key))
  ).length;

  const selectedSignalData = signals.find(s => s.key === selectedSignal);
  const selectedRules = selectedSignal ? signalRules(selectedSignal) : [];
  const selectedGroups = selectedSignal ? signalGroups(selectedSignal) : [];

  async function handleRunTest() {
    setTestRunning(true);
    setTestResult(null);
    try {
      let body: Record<string, unknown>;
      try { body = JSON.parse(testJson) as Record<string, unknown>; }
      catch { toast({ title: "Invalid JSON", variant: "destructive" }); return; }
      const res = await fetchWithAuth("/api/admin/signal-rules/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) setTestResult(await res.json() as typeof testResult);
      else toast({ title: "Evaluation failed", variant: "destructive" });
    } finally { setTestRunning(false); }
  }

  async function handlePreviewProjects() {
    setPreviewRunning(true);
    setPreviewResult(null);
    try {
      let body: Record<string, unknown>;
      try { body = JSON.parse(testJson) as Record<string, unknown>; }
      catch { body = { profileUpdates: {}, parsedFindings: [] }; }
      const res = await fetchWithAuth("/api/admin/signal-rules/preview-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) setPreviewResult(await res.json() as typeof previewResult);
      else toast({ title: "Preview failed", variant: "destructive" });
    } finally { setPreviewRunning(false); }
  }

  async function handleDryRunSow() {
    if (!dryRunClientId) { toast({ title: "Select a client first", variant: "destructive" }); return; }
    setDryRunRunning(true);
    setDryRunResult(null);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules/dry-run-sow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientUserId: Number(dryRunClientId) }),
      });
      if (res.ok) setDryRunResult(await res.json() as typeof dryRunResult);
      else toast({ title: "Dry-run failed", variant: "destructive" });
    } finally { setDryRunRunning(false); }
  }

  async function handleAddRule() {
    if (!selectedSignal || !addRuleForm.sourceKey.trim()) {
      toast({ title: "Signal key and source key are required", variant: "destructive" }); return;
    }
    setSavingRule(true);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signalKey: selectedSignal,
          ruleType: addRuleForm.ruleType,
          sourceKey: addRuleForm.sourceKey.trim(),
          compareValue: needsCompareValue(addRuleForm.ruleType) ? addRuleForm.compareValue.trim() || null : null,
          description: addRuleForm.description.trim() || null,
          groupId: addRuleForm.groupId ? Number(addRuleForm.groupId) : null,
        }),
      });
      if (res.ok) {
        toast({ title: "Rule added" });
        setAddRuleForm({ ruleType: "profile_key_truthy", sourceKey: "", compareValue: "", description: "", groupId: "" });
        await loadAll();
      } else {
        toast({ title: "Failed to add rule", variant: "destructive" });
      }
    } finally { setSavingRule(false); }
  }

  async function handleDeleteRule(id: number) {
    setDeletingRuleId(id);
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rules/${id}`, { method: "DELETE" });
      if (res.ok) { toast({ title: "Rule deleted" }); await loadAll(); }
      else toast({ title: "Failed to delete rule", variant: "destructive" });
    } finally { setDeletingRuleId(null); }
  }

  async function handleSaveEditRule(id: number) {
    setSavingRule(true);
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleType: editRuleForm.ruleType,
          sourceKey: editRuleForm.sourceKey.trim(),
          compareValue: needsCompareValue(editRuleForm.ruleType) ? editRuleForm.compareValue.trim() || null : null,
          description: editRuleForm.description.trim() || null,
        }),
      });
      if (res.ok) {
        toast({ title: "Rule updated" });
        setEditingRuleId(null);
        await loadAll();
      } else {
        toast({ title: "Failed to update rule", variant: "destructive" });
      }
    } finally { setSavingRule(false); }
  }

  async function handleAddGroup() {
    if (!selectedSignal) return;
    setSavingGroup(true);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rule-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signalKey: selectedSignal, logic: addGroupForm.logic, label: addGroupForm.label.trim() || null }),
      });
      if (res.ok) {
        toast({ title: "Group added" });
        setAddGroupForm({ logic: "OR", label: "" });
        await loadAll();
      } else {
        toast({ title: "Failed to add group", variant: "destructive" });
      }
    } finally { setSavingGroup(false); }
  }

  async function handleDeleteGroup(id: number) {
    const res = await fetchWithAuth(`/api/admin/signal-rule-groups/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "Group deleted" }); await loadAll(); }
    else toast({ title: "Failed to delete group", variant: "destructive" });
  }

  async function handleToggleGroupLogic(group: SignalGroup) {
    const newLogic = group.logic === "AND" ? "OR" : "AND";
    const res = await fetchWithAuth(`/api/admin/signal-rule-groups/${group.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logic: newLogic }),
    });
    if (res.ok) await loadAll();
    else toast({ title: "Failed to update group", variant: "destructive" });
  }

  function handleExport() {
    const data = JSON.stringify({ rules, groups }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tenant-signal-rules.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    setImportRunning(true);
    try {
      let body: Record<string, unknown>;
      try { body = JSON.parse(importJson) as Record<string, unknown>; }
      catch { toast({ title: "Invalid JSON", variant: "destructive" }); return; }
      const res = await fetchWithAuth("/api/admin/signal-rules/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json() as { imported: number; snapshotId: number };
        toast({ title: `Imported ${data.imported} rules. Previous rules saved as snapshot.` });
        setShowImportModal(false);
        setImportJson("");
        await loadAll();
      } else {
        toast({ title: "Import failed", variant: "destructive" });
      }
    } finally { setImportRunning(false); }
  }

  async function handleSaveSnapshot() {
    if (!snapshotName.trim()) { toast({ title: "Snapshot name is required", variant: "destructive" }); return; }
    setSavingSnapshot(true);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: snapshotName.trim() }),
      });
      if (res.ok) {
        toast({ title: "Snapshot saved" });
        setSnapshotName("");
        await loadAll();
      } else {
        toast({ title: "Failed to save snapshot", variant: "destructive" });
      }
    } finally { setSavingSnapshot(false); }
  }

  async function handleRestoreVersion(id: number, name: string) {
    if (!confirm(`Restore snapshot "${name}"? Current rules will be backed up automatically.`)) return;
    const res = await fetchWithAuth(`/api/admin/signal-rules/versions/${id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      toast({ title: `Restored "${name}". Previous rules saved as snapshot.` });
      setShowSnapshotsPanel(false);
      await loadAll();
    } else {
      toast({ title: "Restore failed", variant: "destructive" });
    }
  }

  async function handleSaveSimProfile() {
    if (!newProfileForm.name.trim()) { toast({ title: "Profile name is required", variant: "destructive" }); return; }
    setSavingProfile(true);
    try {
      let parsedBody: Record<string, unknown>;
      try { parsedBody = JSON.parse(testJson) as Record<string, unknown>; }
      catch { parsedBody = { profileUpdates: {}, parsedFindings: [] }; }
      const tags = newProfileForm.tags.split(",").map(t => t.trim()).filter(Boolean);
      const res = await fetchWithAuth("/api/admin/signal-rules/simulation-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProfileForm.name.trim(),
          description: newProfileForm.description.trim() || null,
          profileUpdates: (parsedBody.profileUpdates as Record<string, unknown>) ?? {},
          parsedFindings: (parsedBody.parsedFindings as string[]) ?? [],
          tags,
        }),
      });
      if (res.ok) {
        toast({ title: "Profile saved" });
        setNewProfileForm({ name: "", description: "", tags: "" });
        await loadSimProfiles();
      } else {
        toast({ title: "Failed to save profile", variant: "destructive" });
      }
    } finally { setSavingProfile(false); }
  }

  async function handleRunSimProfile(id: number) {
    setRunningProfileId(id);
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rules/simulation-profiles/${id}/run`, { method: "POST" });
      if (res.ok) {
        const result = await res.json() as SimProfileRunResult;
        setProfileRunResults(prev => ({ ...prev, [id]: result }));
        setExpandedProfileId(id);
        setTestResult({ firedSignals: result.firedSignals, ruleTrace: result.ruleTrace });
        const profile = simProfiles.find(p => p.id === id);
        if (profile) {
          setTestJson(JSON.stringify({ profileUpdates: profile.profileUpdates, parsedFindings: profile.parsedFindings }, null, 2));
        }
        toast({ title: "Profile evaluated" });
        await loadSimProfiles();
      } else {
        toast({ title: "Failed to run profile", variant: "destructive" });
      }
    } finally {
      setRunningProfileId(null);
    }
  }

  async function handleImportFromClient() {
    if (!fromClientId) { toast({ title: "Select a client first", variant: "destructive" }); return; }
    setImportingFromClient(true);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules/simulation-profiles/from-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientUserId: Number(fromClientId), tags: ["tenant-import"] }),
      });
      if (res.ok) {
        const profile = await res.json() as SimulationProfile;
        toast({ title: `Profile created: "${profile.name}"` });
        setShowFromClientModal(false);
        setFromClientId("");
        setFromClientName("");
        setFromClientSearch("");
        await loadSimProfiles();
        // Auto-run the newly imported profile
        await handleRunSimProfile(profile.id);
      } else {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to import tenant data", variant: "destructive" });
      }
    } finally {
      setImportingFromClient(false);
    }
  }

  async function handleDeleteSimProfile(id: number) {
    const res = await fetchWithAuth(`/api/admin/signal-rules/simulation-profiles/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "Profile deleted" }); await loadSimProfiles(); }
    else toast({ title: "Failed to delete profile", variant: "destructive" });
  }

  function preloadProfile(profile: SimulationProfile) {
    setTestJson(JSON.stringify({ profileUpdates: profile.profileUpdates, parsedFindings: profile.parsedFindings }, null, 2));
  }

  function applyRulePreset(rule: { ruleType: string; sourceKey: string; compareValue?: string }) {
    setAddRuleForm(f => ({
      ...f,
      ruleType: rule.ruleType,
      sourceKey: rule.sourceKey,
      compareValue: rule.compareValue ?? "",
    }));
    setActiveTab("rules");
  }

  function applyScriptFieldToRule(key: string) {
    setAddRuleForm(f => ({ ...f, sourceKey: key }));
    setShowScriptExplorer(false);
    setActiveTab("rules");
  }

  const filteredScriptFields = scriptFields.filter(f =>
    !scriptFieldSearch || f.key.toLowerCase().includes(scriptFieldSearch.toLowerCase())
  );

  const filteredSimProfiles = simProfiles.filter(p =>
    !simProfileSearch ||
    p.name.toLowerCase().includes(simProfileSearch.toLowerCase()) ||
    p.tags.some(t => t.toLowerCase().includes(simProfileSearch.toLowerCase()))
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-[#0078D4] animate-spin" />
      </div>
    );
  }

  const groupedRules = (signalKey: string) => {
    const sr = signalRules(signalKey);
    const sg = signalGroups(signalKey);
    const ungrouped = sr.filter(r => r.groupId === null || r.groupId === undefined);
    return { groups: sg, ungrouped };
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-[#30363D] bg-[#0D1117] gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* View switcher */}
          <div className="flex items-center border border-[#30363D] rounded-lg overflow-hidden">
            <button
              onClick={() => setPageView("rules")}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${pageView === "rules" ? "bg-[#0078D4] text-white" : "bg-[#0D1117] text-[#7D8590] hover:text-[#E6EDF3]"}`}
            >
              Signal Rules
            </button>
            <button
              onClick={() => { setPageView("simulate"); void loadSimProfiles(); void loadClientsWithRuns(); }}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 ${pageView === "simulate" ? "bg-[#0078D4] text-white" : "bg-[#0D1117] text-[#7D8590] hover:text-[#E6EDF3]"}`}
            >
              <FlaskConical className="w-3 h-3" /> Simulate
            </button>
          </div>
          {pageView === "rules" && (
            <>
              <button
                onClick={() => { setShowTestModal(true); void loadSimProfiles(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0078D4]/10 text-[#0078D4] text-xs font-semibold rounded-lg border border-[#0078D4]/30 hover:bg-[#0078D4]/20 transition-colors"
              >
                <Play className="w-3.5 h-3.5" /> Test Evaluation
              </button>
              <button
                onClick={() => { setShowPreviewModal(true); void handlePreviewProjects(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] text-[#C9D1D9] text-xs font-semibold rounded-lg border border-[#30363D] hover:border-[#0078D4]/40 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" /> Preview Projects
              </button>
              <button
                onClick={() => { setShowDryRunModal(true); void loadClients(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] text-[#C9D1D9] text-xs font-semibold rounded-lg border border-[#30363D] hover:border-[#0078D4]/40 transition-colors"
              >
                <Zap className="w-3.5 h-3.5" /> Dry-Run SOW
              </button>
            </>
          )}
        </div>
        <button
          onClick={() => setShowConflictsPanel(true)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
            conflicts.length > 0
              ? "bg-amber-900/20 text-amber-400 border-amber-500/30 hover:bg-amber-900/30"
              : "bg-[#1C2128] text-[#7D8590] border-[#30363D]"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          {conflicts.length} Conflict{conflicts.length !== 1 ? "s" : ""}
        </button>
      </div>

      {/* ── Simulate view ─────────────────────────────────────────────────────── */}
      {pageView === "simulate" && (
        <div className="flex-1 overflow-y-auto bg-[#0D1117] p-6 space-y-6">
          {/* Header row */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-base font-bold text-[#E6EDF3]">Simulation Profiles</h2>
              <p className="text-xs text-[#7D8590] mt-0.5">
                Test rule changes against saved tenant data snapshots before publishing. Profiles can be created manually or imported directly from a real client's script run history.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setShowFromClientModal(true); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0078D4]/10 text-[#0078D4] text-xs font-semibold rounded-lg border border-[#0078D4]/30 hover:bg-[#0078D4]/20 transition-colors"
              >
                <Database className="w-3.5 h-3.5" /> Import from Tenant
              </button>
              <button
                onClick={() => { setShowTestModal(true); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] text-[#C9D1D9] text-xs font-semibold rounded-lg border border-[#30363D] hover:border-[#0078D4]/40 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New Manual Profile
              </button>
            </div>
          </div>

          {/* Search */}
          <input
            value={simProfileSearch}
            onChange={e => setSimProfileSearch(e.target.value)}
            placeholder="Search profiles by name or tag…"
            className="w-full max-w-sm border border-[#30363D] bg-[#1C2128] text-[#C9D1D9] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
          />

          {/* Profile cards */}
          {filteredSimProfiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FlaskConical className="w-10 h-10 text-[#30363D] mb-3" />
              <p className="text-sm font-semibold text-[#7D8590]">No simulation profiles yet</p>
              <p className="text-xs text-[#484F58] mt-1 max-w-sm">Import real tenant data or create a manual profile to test signal rules before they affect live SOW generation.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSimProfiles.map(profile => {
                const result = profileRunResults[profile.id];
                const isExpanded = expandedProfileId === profile.id;
                const isRunning = runningProfileId === profile.id;
                return (
                  <div key={profile.id} className="border border-[#30363D] rounded-xl overflow-hidden bg-[#161B22]">
                    {/* Profile header */}
                    <div className="flex items-center justify-between px-5 py-3.5 gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button
                          onClick={() => setExpandedProfileId(isExpanded ? null : profile.id)}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left"
                        >
                          <ChevronRight className={`w-4 h-4 text-[#7D8590] flex-shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#E6EDF3] truncate">{profile.name}</p>
                            {profile.description && (
                              <p className="text-xs text-[#484F58] truncate">{profile.description}</p>
                            )}
                          </div>
                        </button>
                        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                          {profile.tags.map(t => (
                            <span key={t} className={`text-xs px-2 py-0.5 rounded-full font-medium ${t === "tenant-import" ? "bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/20" : "bg-[#30363D] text-[#7D8590]"}`}>
                              {t === "tenant-import" ? <><Database className="w-2.5 h-2.5 inline mr-1" />{t}</> : t}
                            </span>
                          ))}
                          {profile.lastRunAt && (
                            <span className="text-xs text-[#484F58] flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              {new Date(profile.lastRunAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => void handleRunSimProfile(profile.id)}
                          disabled={isRunning}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0078D4] text-white text-xs font-semibold rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors"
                          title="Run simulation"
                        >
                          {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          {isRunning ? "Running…" : "Run"}
                        </button>
                        <button
                          onClick={() => { preloadProfile(profile); setShowTestModal(true); }}
                          className="p-1.5 text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#30363D]/50 rounded transition-colors"
                          title="Edit in test modal"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void handleDeleteSimProfile(profile.id)}
                          className="p-1.5 text-[#7D8590] hover:text-red-500 hover:bg-red-900/10 rounded transition-colors"
                          title="Delete profile"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded result */}
                    {isExpanded && result && (
                      <div className="border-t border-[#30363D] px-5 py-4 space-y-4">
                        {/* Fired signals */}
                        <div>
                          <p className="text-xs font-bold text-[#7D8590] uppercase tracking-wide mb-2">Signals Fired ({result.firedSignals.length})</p>
                          <div className="flex flex-wrap gap-2">
                            {result.firedSignals.map(s => (
                              <div key={s.key} className="group relative">
                                <span className="text-xs bg-green-900/30 text-green-400 px-2.5 py-1 rounded-full border border-green-500/20 font-medium cursor-help">
                                  <Check className="w-3 h-3 inline mr-1" />{s.label}
                                </span>
                                {s.expectedImpact && (
                                  <div className="hidden group-hover:block absolute bottom-full left-0 mb-2 w-72 bg-[#1C2128] border border-[#30363D] rounded-xl p-3 text-xs text-[#C9D1D9] z-50 shadow-xl">
                                    <p className="font-semibold text-[#E6EDF3] mb-1">Why this matters</p>
                                    {s.expectedImpact}
                                  </div>
                                )}
                              </div>
                            ))}
                            {result.firedSignals.length === 0 && (
                              <p className="text-xs text-[#484F58] italic">No signals fired</p>
                            )}
                          </div>
                        </div>

                        {/* Project diff */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs font-bold text-green-400 uppercase tracking-wide mb-2">
                              Included Projects ({result.includedProjects.length})
                            </p>
                            <div className="space-y-1.5 max-h-52 overflow-y-auto">
                              {result.includedProjects.map(p => (
                                <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-green-950/20 border border-green-500/10 rounded-lg">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                                    <span className="text-xs text-[#C9D1D9] truncate">{p.title}</span>
                                  </div>
                                  {p.priceRange && (
                                    <span className="text-xs text-[#484F58] flex-shrink-0">{p.priceRange}</span>
                                  )}
                                </div>
                              ))}
                              {result.includedProjects.length === 0 && (
                                <p className="text-xs text-[#7D8590] italic px-2">No projects would be included.</p>
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-[#484F58] uppercase tracking-wide mb-2">
                              Excluded Projects ({result.excludedProjects.length})
                            </p>
                            <div className="space-y-1.5 max-h-52 overflow-y-auto">
                              {result.excludedProjects.map((e, i) => (
                                <div key={i} className="px-3 py-2 bg-[#1C2128] rounded-lg">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <X className="w-3.5 h-3.5 text-[#484F58] flex-shrink-0" />
                                    <span className="text-xs text-[#7D8590] truncate">{e.project.title}</span>
                                  </div>
                                  <p className="text-xs text-[#30363D] ml-5 mt-0.5 truncate" title={e.reason}>{e.reason}</p>
                                </div>
                              ))}
                              {result.excludedProjects.length === 0 && (
                                <p className="text-xs text-[#7D8590] italic px-2">No projects excluded.</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Expanded but no result yet */}
                    {isExpanded && !result && (
                      <div className="border-t border-[#30363D] px-5 py-6 text-center">
                        <p className="text-xs text-[#7D8590]">Click <strong className="text-[#C9D1D9]">Run</strong> to see which projects would be included or excluded for this profile.</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Main split panel ──────────────────────────────────────────────────── */}
      {pageView === "rules" && (
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel ──────────────────────────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 border-r border-[#30363D] flex flex-col overflow-hidden bg-[#0D1117]">
          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-[#30363D]">
            <span className="text-sm font-bold text-[#E6EDF3]">Tenant Signals</span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleExport}
                className="p-1.5 text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] rounded transition-colors"
                title="Export JSON"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setShowImportModal(true); }}
                className="p-1.5 text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] rounded transition-colors"
                title="Import JSON"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setShowSnapshotsPanel(true); }}
                className="p-1.5 text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] rounded transition-colors"
                title="Snapshots"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Signal list */}
          <div className="flex-1 overflow-y-auto">
            {signals.map(sig => {
              const sr = signalRules(sig.key);
              const conflictsForSig = signalConflictCount(sig.key);
              const hasRules = sr.length > 0;
              const hp = health[sig.key];
              const isSelected = selectedSignal === sig.key;

              let dotColor = "bg-[#484F58]";
              if (conflictsForSig > 0) dotColor = "bg-amber-400";
              else if (hasRules || sig.key === "alwaysInclude") dotColor = "bg-green-500";

              return (
                <button
                  key={sig.key}
                  onClick={() => { setSelectedSignal(sig.key); setActiveTab("rules"); }}
                  className={`w-full flex items-center gap-2.5 px-4 py-3 text-left transition-colors border-b border-[#30363D]/50 ${
                    isSelected ? "bg-[#0078D4]/10 border-l-2 border-l-[#0078D4]" : "hover:bg-[#1C2128]"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[#E6EDF3] truncate">{sig.label}</span>
                      {sr.length > 0 && (
                        <span className="text-xs text-[#484F58] bg-[#1C2128] px-1.5 py-0.5 rounded font-mono">{sr.length}</span>
                      )}
                      {conflictsForSig > 0 && (
                        <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                      )}
                    </div>
                    {hp && (
                      <p className="text-xs text-[#484F58] mt-0.5">{hp.clientCount} / {hp.totalClients} clients</p>
                    )}
                  </div>
                  <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${isSelected ? "text-[#0078D4] rotate-90" : "text-[#484F58]"}`} />
                </button>
              );
            })}
          </div>

          {/* Footer: Script Field Explorer */}
          <div className="flex-shrink-0 border-t border-[#30363D] p-3">
            <button
              onClick={() => { setShowScriptExplorer(true); void loadScriptFields(); }}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-[#1C2128] text-[#7D8590] text-xs font-semibold rounded-lg hover:text-[#E6EDF3] hover:bg-[#30363D]/50 transition-colors"
            >
              <Search className="w-3.5 h-3.5" /> Script Field Explorer
            </button>
          </div>
        </div>

        {/* ── Right panel ─────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden flex flex-col bg-[#0D1117]">
          {!selectedSignal ? (
            <div className="flex items-center justify-center h-full text-[#7D8590] text-sm">
              Select a signal to configure rules
            </div>
          ) : (
            <>
              {/* Signal header */}
              <div className="flex-shrink-0 px-6 py-4 border-b border-[#30363D]">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-lg font-bold text-[#E6EDF3]">{selectedSignalData?.label}</h2>
                  <code className="text-xs bg-[#1C2128] text-[#00B4D8] px-2 py-0.5 rounded font-mono border border-[#30363D]">{selectedSignal}</code>
                </div>
                {selectedSignalData?.description && (
                  <p className="text-sm text-[#7D8590] mt-1">{selectedSignalData.description}</p>
                )}
              </div>

              {/* Tabs */}
              <div className="flex-shrink-0 flex gap-0 border-b border-[#30363D]">
                {(["rules", "docs", "audit"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-5 py-2.5 text-sm font-semibold capitalize transition-colors border-b-2 ${
                      activeTab === tab
                        ? "border-[#0078D4] text-[#0078D4]"
                        : "border-transparent text-[#7D8590] hover:text-[#E6EDF3]"
                    }`}
                  >
                    {tab === "docs" ? "Documentation" : tab === "audit" ? "Audit Log" : "Rules"}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto p-6">
                {/* ── Rules tab ─────────────────────────────────────────────── */}
                {activeTab === "rules" && (
                  <div className="space-y-6">
                    {/* Groups */}
                    {selectedGroups.map(group => {
                      const groupRules = selectedRules.filter(r => r.groupId === group.id);
                      return (
                        <div key={group.id} className="border border-[#30363D] rounded-xl overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-2.5 bg-[#1C2128] border-b border-[#30363D]">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => void handleToggleGroupLogic(group)}
                                className={`text-xs font-bold px-2 py-0.5 rounded border ${
                                  group.logic === "AND"
                                    ? "bg-blue-900/30 text-blue-400 border-blue-500/30"
                                    : "bg-green-900/30 text-green-400 border-green-500/30"
                                }`}
                                title="Click to toggle AND/OR"
                              >
                                {group.logic}
                              </button>
                              <span className="text-sm font-semibold text-[#C9D1D9]">{group.label ?? `Group ${group.id}`}</span>
                            </div>
                            <button onClick={() => void handleDeleteGroup(group.id)} className="text-[#484F58] hover:text-red-500 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="divide-y divide-[#30363D]/50">
                            {groupRules.map(rule => (
                              <RuleRow
                                key={rule.id}
                                rule={rule}
                                conflictRuleIds={conflictRuleIds}
                                conflicts={conflicts}
                                editingRuleId={editingRuleId}
                                editRuleForm={editRuleForm}
                                setEditRuleForm={setEditRuleForm}
                                setEditingRuleId={setEditingRuleId}
                                deletingRuleId={deletingRuleId}
                                savingRule={savingRule}
                                onEdit={r => { setEditingRuleId(r.id); setEditRuleForm({ ruleType: r.ruleType, sourceKey: r.sourceKey, compareValue: r.compareValue ?? "", description: r.description ?? "" }); }}
                                onSave={() => void handleSaveEditRule(rule.id)}
                                onDelete={() => void handleDeleteRule(rule.id)}
                              />
                            ))}
                            {groupRules.length === 0 && (
                              <p className="px-4 py-3 text-xs text-[#484F58] italic">No rules in this group yet — add rules below and assign them to this group.</p>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Ungrouped rules */}
                    {selectedRules.filter(r => r.groupId === null || r.groupId === undefined).length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-[#7D8590] uppercase tracking-wide mb-2">Ungrouped Rules (each acts as its own OR condition)</p>
                        <div className="border border-[#30363D] rounded-xl divide-y divide-[#30363D]/50 overflow-hidden">
                          {selectedRules.filter(r => r.groupId === null || r.groupId === undefined).map(rule => (
                            <RuleRow
                              key={rule.id}
                              rule={rule}
                              conflictRuleIds={conflictRuleIds}
                              conflicts={conflicts}
                              editingRuleId={editingRuleId}
                              editRuleForm={editRuleForm}
                              setEditRuleForm={setEditRuleForm}
                              setEditingRuleId={setEditingRuleId}
                              deletingRuleId={deletingRuleId}
                              savingRule={savingRule}
                              onEdit={r => { setEditingRuleId(r.id); setEditRuleForm({ ruleType: r.ruleType, sourceKey: r.sourceKey, compareValue: r.compareValue ?? "", description: r.description ?? "" }); }}
                              onSave={() => void handleSaveEditRule(rule.id)}
                              onDelete={() => void handleDeleteRule(rule.id)}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedRules.length === 0 && selectedGroups.length === 0 && (
                      <p className="text-sm text-[#7D8590] italic">No rules configured for this signal yet.</p>
                    )}

                    {/* Add rule form */}
                    <div className="border border-dashed border-[#30363D] rounded-xl p-5 space-y-4">
                      <p className="text-xs font-bold text-[#C9D1D9] uppercase tracking-wide">Add Rule</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[#7D8590] mb-1">Rule Type</label>
                          <select
                            value={addRuleForm.ruleType}
                            onChange={e => setAddRuleForm(f => ({ ...f, ruleType: e.target.value }))}
                            className="w-full border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
                          >
                            {RULE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-[#7D8590] mb-1">
                            {addRuleForm.ruleType === "findings_keyword" ? "Keyword" : "Profile Key"}
                          </label>
                          <input
                            value={addRuleForm.sourceKey}
                            onChange={e => setAddRuleForm(f => ({ ...f, sourceKey: e.target.value }))}
                            placeholder="e.g. mfaEnforced"
                            className="w-full border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {needsCompareValue(addRuleForm.ruleType) && (
                          <div>
                            <label className="block text-xs text-[#7D8590] mb-1">Compare Value</label>
                            <input
                              value={addRuleForm.compareValue}
                              onChange={e => setAddRuleForm(f => ({ ...f, compareValue: e.target.value }))}
                              placeholder="e.g. 60"
                              className="w-full border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
                            />
                          </div>
                        )}
                        <div>
                          <label className="block text-xs text-[#7D8590] mb-1">Group (optional)</label>
                          <select
                            value={addRuleForm.groupId}
                            onChange={e => setAddRuleForm(f => ({ ...f, groupId: e.target.value }))}
                            className="w-full border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
                          >
                            <option value="">— Ungrouped —</option>
                            {selectedGroups.map(g => (
                              <option key={g.id} value={g.id}>{g.label ?? `Group ${g.id}`} ({g.logic})</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-[#7D8590] mb-1">Description (optional)</label>
                        <input
                          value={addRuleForm.description}
                          onChange={e => setAddRuleForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="Why does this rule matter?"
                          className="w-full border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
                        />
                      </div>
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          onClick={() => void handleAddRule()}
                          disabled={savingRule || !addRuleForm.sourceKey.trim()}
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#0078D4] text-white text-sm font-semibold rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors"
                        >
                          {savingRule ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add Rule
                        </button>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[#7D8590]">Add Group:</span>
                          <select
                            value={addGroupForm.logic}
                            onChange={e => setAddGroupForm(f => ({ ...f, logic: e.target.value as "AND" | "OR" }))}
                            className="border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2 py-1 text-xs focus:outline-none"
                          >
                            <option value="OR">OR</option>
                            <option value="AND">AND</option>
                          </select>
                          <input
                            value={addGroupForm.label}
                            onChange={e => setAddGroupForm(f => ({ ...f, label: e.target.value }))}
                            placeholder="Label (optional)"
                            className="border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2 py-1 text-xs focus:outline-none w-36"
                          />
                          <button
                            onClick={() => void handleAddGroup()}
                            disabled={savingGroup}
                            className="px-2 py-1 bg-[#1C2128] text-[#C9D1D9] text-xs rounded hover:bg-[#30363D] transition-colors"
                          >
                            {savingGroup ? <Loader2 className="w-3 h-3 animate-spin" /> : "+"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Documentation tab ─────────────────────────────────────── */}
                {activeTab === "docs" && selectedSignalData && (
                  <div className="space-y-8 max-w-2xl">
                    <div>
                      <h3 className="text-sm font-bold text-[#E6EDF3] uppercase tracking-wide mb-2">Expected Impact</h3>
                      <p className="text-sm text-[#C9D1D9] leading-relaxed bg-[#1C2128] rounded-xl p-4 border border-[#30363D]">
                        {selectedSignalData.expectedImpact}
                      </p>
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-[#E6EDF3] uppercase tracking-wide mb-2">Projects Unlocked by This Signal</h3>
                      {(selectedSignalData.unlocksProjects ?? []).length === 0 ? (
                        <p className="text-sm text-[#7D8590] italic">No projects are currently triggered by this signal — set triggeredBy on an Engagement Project to link one.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {(selectedSignalData.unlocksProjects ?? []).map(p => (
                            <a
                              key={p.id}
                              href="/admin-panel/delivery/engagement-projects"
                              className="text-xs bg-[#0078D4]/10 text-[#0078D4] border border-[#0078D4]/20 px-2.5 py-1 rounded-full hover:bg-[#0078D4]/20 transition-colors"
                            >
                              {p.title}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>

                    {selectedSignalData.recommendedRules.length > 0 && (
                      <div>
                        <h3 className="text-sm font-bold text-[#E6EDF3] uppercase tracking-wide mb-2">Recommended Rule Patterns</h3>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border border-[#30363D] rounded-xl overflow-hidden">
                            <thead>
                              <tr className="bg-[#1C2128] text-[#7D8590] text-xs">
                                <th className="text-left px-4 py-2.5">Rule Type</th>
                                <th className="text-left px-4 py-2.5">Source Key</th>
                                <th className="text-left px-4 py-2.5">Value</th>
                                <th className="text-left px-4 py-2.5">Rationale</th>
                                <th className="px-4 py-2.5"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#30363D]">
                              {selectedSignalData.recommendedRules.map((r, i) => (
                                <tr key={i} className="bg-[#0D1117]">
                                  <td className="px-4 py-2.5">{ruleTypePill(r.ruleType)}</td>
                                  <td className="px-4 py-2.5 font-mono text-xs text-[#C9D1D9]">{r.sourceKey}</td>
                                  <td className="px-4 py-2.5 font-mono text-xs text-[#7D8590]">{r.compareValue ?? "—"}</td>
                                  <td className="px-4 py-2.5 text-xs text-[#7D8590]">{r.rationale}</td>
                                  <td className="px-4 py-2.5">
                                    <button
                                      onClick={() => applyRulePreset(r)}
                                      className="text-xs text-[#0078D4] hover:underline whitespace-nowrap"
                                    >
                                      Use
                                    </button>
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

                {/* ── Audit Log tab ──────────────────────────────────────────── */}
                {activeTab === "audit" && (
                  <div>
                    {auditLoading ? (
                      <div className="flex items-center gap-2 text-[#7D8590] text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
                    ) : auditLog.length === 0 ? (
                      <p className="text-sm text-[#7D8590] italic">No audit log entries for this signal yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {auditLog.map(entry => (
                          <div key={entry.id} className="flex items-start gap-3 p-3 bg-[#1C2128] rounded-lg border border-[#30363D]">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${
                              entry.action === "create" ? "bg-green-900/30 text-green-400" :
                              entry.action === "delete" ? "bg-red-900/30 text-red-400" :
                              entry.action === "import" ? "bg-blue-900/30 text-blue-400" :
                              entry.action === "restore_version" ? "bg-purple-900/30 text-purple-400" :
                              "bg-[#30363D] text-[#7D8590]"
                            }`}>{entry.action}</span>
                            <div className="flex-1 min-w-0">
                              {entry.note && <p className="text-xs text-[#C9D1D9]">{entry.note}</p>}
                              {entry.ruleId && <p className="text-xs text-[#7D8590]">Rule #{entry.ruleId}</p>}
                            </div>
                            <span className="text-xs text-[#484F58] flex-shrink-0">{new Date(entry.createdAt).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────────── */}

      {/* Test Evaluation Modal */}
      {showTestModal && (
        <Modal title="Test Evaluation" onClose={() => setShowTestModal(false)} wide>
          <div className="flex gap-4 h-[60vh]">
            {/* Left: Simulation Profiles */}
            <div className="w-64 flex-shrink-0 flex flex-col border border-[#30363D] rounded-xl overflow-hidden">
              <div className="flex-shrink-0 px-3 py-2 border-b border-[#30363D] bg-[#1C2128]">
                <p className="text-xs font-bold text-[#C9D1D9]">Saved Profiles</p>
                <input
                  value={simProfileSearch}
                  onChange={e => setSimProfileSearch(e.target.value)}
                  placeholder="Search…"
                  className="mt-1.5 w-full border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2 py-1 text-xs focus:outline-none"
                />
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-[#30363D]/50">
                {filteredSimProfiles.map(p => (
                  <div key={p.id} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#E6EDF3] truncate">{p.name}</p>
                        {p.tags.length > 0 && (
                          <div className="flex flex-wrap gap-0.5 mt-0.5">
                            {p.tags.map(t => (
                              <span key={t} className="text-xs bg-[#30363D] text-[#7D8590] px-1.5 py-0.5 rounded-full">{t}</span>
                            ))}
                          </div>
                        )}
                        {p.lastRunAt && (
                          <p className="text-xs text-[#484F58] mt-0.5 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {new Date(p.lastRunAt).toLocaleDateString()}
                            {p.lastRunResult && (
                              <span className={`ml-1 w-1.5 h-1.5 rounded-full ${p.lastRunResult.length > 1 ? "bg-green-500" : "bg-amber-500"}`} />
                            )}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => preloadProfile(p)} className="p-1 text-[#7D8590] hover:text-[#0078D4] transition-colors" title="Load">
                          <Download className="w-3 h-3" />
                        </button>
                        <button onClick={() => void handleRunSimProfile(p.id)} className="p-1 text-[#7D8590] hover:text-green-400 transition-colors" title="Run">
                          <Play className="w-3 h-3" />
                        </button>
                        <button onClick={() => void handleDeleteSimProfile(p.id)} className="p-1 text-[#7D8590] hover:text-red-500 transition-colors" title="Delete">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredSimProfiles.length === 0 && (
                  <p className="px-3 py-4 text-xs text-[#484F58] italic">No profiles yet.</p>
                )}
              </div>
              <div className="flex-shrink-0 border-t border-[#30363D] p-3 space-y-1.5">
                <p className="text-xs text-[#7D8590] font-semibold">Save current JSON as profile</p>
                <input
                  value={newProfileForm.name}
                  onChange={e => setNewProfileForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Profile name"
                  className="w-full border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2 py-1 text-xs focus:outline-none"
                />
                <input
                  value={newProfileForm.tags}
                  onChange={e => setNewProfileForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="Tags (comma-separated)"
                  className="w-full border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2 py-1 text-xs focus:outline-none"
                />
                <button
                  onClick={() => void handleSaveSimProfile()}
                  disabled={savingProfile || !newProfileForm.name.trim()}
                  className="w-full px-2 py-1.5 bg-[#0078D4]/10 text-[#0078D4] text-xs font-semibold rounded hover:bg-[#0078D4]/20 disabled:opacity-50 transition-colors"
                >
                  {savingProfile ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Save Profile"}
                </button>
              </div>
            </div>

            {/* Right: JSON editor + results */}
            <div className="flex-1 flex flex-col gap-4 overflow-hidden">
              <div className="flex-1 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-[#7D8590] font-semibold">JSON Input</label>
                  <button
                    onClick={() => void handleRunTest()}
                    disabled={testRunning}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0078D4] text-white text-xs font-semibold rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors"
                  >
                    {testRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Run
                  </button>
                </div>
                <textarea
                  value={testJson}
                  onChange={e => setTestJson(e.target.value)}
                  className="flex-1 border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 resize-none"
                  spellCheck={false}
                />
              </div>

              {testResult && (
                <div className="flex-1 overflow-y-auto space-y-4">
                  <div>
                    <p className="text-xs font-bold text-[#C9D1D9] uppercase tracking-wide mb-2">Fired Signals</p>
                    <div className="flex flex-wrap gap-2">
                      {testResult.firedSignals.map(s => (
                        <div key={s.key} className="group relative">
                          <span className="text-xs bg-green-900/30 text-green-400 px-2.5 py-1 rounded-full border border-green-500/20 font-medium cursor-help">
                            <Check className="w-3 h-3 inline mr-1" />{s.label}
                          </span>
                          {s.expectedImpact && (
                            <div className="hidden group-hover:block absolute bottom-full left-0 mb-2 w-72 bg-[#1C2128] border border-[#30363D] rounded-xl p-3 text-xs text-[#C9D1D9] z-50 shadow-xl">
                              <p className="font-semibold text-[#E6EDF3] mb-1">Why this matters</p>
                              {s.expectedImpact}
                            </div>
                          )}
                        </div>
                      ))}
                      {testResult.firedSignals.length === 0 && (
                        <p className="text-xs text-[#7D8590] italic">No signals fired</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#C9D1D9] uppercase tracking-wide mb-2">Rule Trace</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border border-[#30363D] rounded-xl overflow-hidden">
                        <thead>
                          <tr className="bg-[#1C2128] text-[#7D8590]">
                            <th className="text-left px-3 py-2">Signal</th>
                            <th className="text-left px-3 py-2">Rule #</th>
                            <th className="text-left px-3 py-2">Result</th>
                            <th className="text-left px-3 py-2">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#30363D]">
                          {testResult.ruleTrace.map((t, i) => (
                            <tr key={i} className={t.result ? "bg-green-950/20" : "bg-[#0D1117]"}>
                              <td className="px-3 py-1.5 font-mono">{t.signalKey}</td>
                              <td className="px-3 py-1.5 text-[#7D8590]">{t.ruleId}</td>
                              <td className="px-3 py-1.5">{t.result ? <Check className="w-3 h-3 text-green-400" /> : <X className="w-3 h-3 text-[#484F58]" />}</td>
                              <td className="px-3 py-1.5 text-[#7D8590]">{t.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Preview Projects Modal */}
      {showPreviewModal && (
        <Modal title="Preview Projects" onClose={() => setShowPreviewModal(false)} wide>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-[#7D8590]">Projects that would be included based on current JSON in Test Evaluation.</p>
              <button
                onClick={() => void handlePreviewProjects()}
                disabled={previewRunning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0078D4] text-white text-xs font-semibold rounded-lg disabled:opacity-50"
              >
                {previewRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Run Preview
              </button>
            </div>
            {previewResult && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold text-green-400 uppercase tracking-wide mb-2">Included ({previewResult.included.length})</p>
                  <div className="space-y-1.5">
                    {previewResult.included.map((p: { id: number; title: string }) => (
                      <div key={p.id} className="flex items-center gap-2 text-sm text-[#C9D1D9]">
                        <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" /> {p.title}
                      </div>
                    ))}
                    {previewResult.included.length === 0 && <p className="text-sm text-[#7D8590] italic">None</p>}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-bold text-[#7D8590] uppercase tracking-wide mb-2">Excluded ({previewResult.excluded.length})</p>
                  <div className="space-y-1.5">
                    {previewResult.excluded.map((e: { project: { id: number; title: string }; reason: string }, i: number) => (
                      <div key={i} className="text-sm text-[#484F58]" title={e.reason}>
                        <X className="w-3.5 h-3.5 inline mr-1.5 text-[#484F58]" />{e.project.title}
                        <p className="text-xs text-[#30363D] ml-5">{e.reason}</p>
                      </div>
                    ))}
                    {previewResult.excluded.length === 0 && <p className="text-sm text-[#7D8590] italic">None excluded</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Dry-Run SOW Modal */}
      {showDryRunModal && (
        <Modal title="Dry-Run SOW" onClose={() => setShowDryRunModal(false)} wide>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-[#7D8590] mb-1.5">Select client</label>
              <select
                value={dryRunClientId}
                onChange={e => setDryRunClientId(e.target.value)}
                className="w-full border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
              >
                <option value="">— choose a client —</option>
                {clients.map(c => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name ?? c.email}{c.company ? ` · ${c.company}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <button
                onClick={() => void handleDryRunSow()}
                disabled={dryRunRunning || !dryRunClientId}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0078D4] text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {dryRunRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Run Dry-Run
              </button>
              {dryRunResult && (
                <p className="text-xs text-amber-400 bg-amber-900/20 border border-amber-500/20 px-3 py-1.5 rounded-lg">{dryRunResult.note}</p>
              )}
            </div>
            {dryRunResult && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold text-green-400 uppercase tracking-wide mb-2">Included Projects</p>
                  {dryRunResult.includedProjects.map((p, i) => (
                    <p key={i} className="text-sm text-[#C9D1D9] flex items-center gap-1.5 mb-1"><Check className="w-3.5 h-3.5 text-green-400" /> {p.title}</p>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-bold text-[#7D8590] uppercase tracking-wide mb-2">Excluded Projects</p>
                  {dryRunResult.excludedProjects.map((e, i) => (
                    <div key={i} className="mb-1">
                      <p className="text-sm text-[#484F58] flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> {e.project.title}</p>
                      <p className="text-xs text-[#30363D] ml-5">{e.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Conflicts Panel */}
      {showConflictsPanel && (
        <Modal title={`Rule Conflicts (${conflicts.length})`} onClose={() => setShowConflictsPanel(false)}>
          {conflicts.length === 0 ? (
            <p className="text-sm text-[#7D8590] italic">No conflicts detected.</p>
          ) : (
            <div className="space-y-3">
              {conflicts.map((c, i) => (
                <div key={i} className="p-4 bg-amber-900/10 border border-amber-500/20 rounded-xl">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-[#C9D1D9]">{c.description}</p>
                      <p className="text-xs text-[#7D8590] mt-1">Rule IDs: {c.ruleIds.join(", ")}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Snapshots Panel */}
      {showSnapshotsPanel && (
        <Modal title="Rule Snapshots" onClose={() => setShowSnapshotsPanel(false)}>
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                value={snapshotName}
                onChange={e => setSnapshotName(e.target.value)}
                placeholder="Snapshot name…"
                className="flex-1 border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
              />
              <button
                onClick={() => void handleSaveSnapshot()}
                disabled={savingSnapshot || !snapshotName.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0078D4] text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {savingSnapshot ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
              </button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {versions.map(v => (
                <div key={v.id} className="flex items-center justify-between p-3 bg-[#1C2128] rounded-xl border border-[#30363D]">
                  <div>
                    <p className="text-sm font-semibold text-[#E6EDF3]">{v.name}</p>
                    <p className="text-xs text-[#7D8590]">{v.ruleCount} rules · {new Date(v.createdAt).toLocaleString()}</p>
                  </div>
                  <button
                    onClick={() => void handleRestoreVersion(v.id, v.name)}
                    className="text-xs text-[#0078D4] hover:underline"
                  >
                    Restore
                  </button>
                </div>
              ))}
              {versions.length === 0 && <p className="text-sm text-[#7D8590] italic">No snapshots yet.</p>}
            </div>
          </div>
        </Modal>
      )}

      {/* Script Field Explorer Drawer */}
      {showScriptExplorer && (
        <Modal title="Script Field Explorer" onClose={() => setShowScriptExplorer(false)} wide>
          <div className="space-y-3">
            <input
              value={scriptFieldSearch}
              onChange={e => setScriptFieldSearch(e.target.value)}
              placeholder="Search profile keys…"
              className="w-full border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
            />
            {filteredScriptFields.length === 0 ? (
              <p className="text-sm text-[#7D8590] italic">No script fields found. Run some scripts first.</p>
            ) : (
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-sm border border-[#30363D] rounded-xl overflow-hidden">
                  <thead>
                    <tr className="bg-[#1C2128] text-[#7D8590] text-xs">
                      <th className="text-left px-4 py-2.5">Key</th>
                      <th className="text-left px-4 py-2.5">Type</th>
                      <th className="text-left px-4 py-2.5">Examples</th>
                      <th className="text-left px-4 py-2.5">Seen in</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363D]">
                    {filteredScriptFields.map(f => (
                      <tr key={f.key} className="bg-[#0D1117]">
                        <td className="px-4 py-2.5 font-mono text-xs text-[#C9D1D9]">{f.key}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            f.type === "boolean" ? "bg-green-900/30 text-green-400" :
                            f.type === "number" ? "bg-blue-900/30 text-blue-400" :
                            "bg-[#30363D] text-[#7D8590]"
                          }`}>{f.type}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[#7D8590] font-mono">{f.examples.map(e => JSON.stringify(e)).join(", ")}</td>
                        <td className="px-4 py-2.5 text-xs text-[#484F58]">{f.seenInNRuns} run{f.seenInNRuns !== 1 ? "s" : ""}</td>
                        <td className="px-4 py-2.5">
                          <button onClick={() => applyScriptFieldToRule(f.key)} className="text-xs text-[#0078D4] hover:underline">
                            Use in rule
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <Modal title="Import Rules" onClose={() => setShowImportModal(false)}>
          <div className="space-y-4">
            <p className="text-sm text-[#7D8590]">Paste JSON below. Current rules will be backed up as a snapshot before import.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => setImportJson(ev.target?.result as string);
                reader.readAsText(file);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] text-[#C9D1D9] text-sm rounded-lg border border-[#30363D] hover:border-[#0078D4]/40 transition-colors"
            >
              <Upload className="w-4 h-4" /> Upload JSON File
            </button>
            <textarea
              value={importJson}
              onChange={e => setImportJson(e.target.value)}
              rows={10}
              placeholder='{"rules": [...], "groups": [...]}'
              className="w-full border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 resize-none"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowImportModal(false)} className="px-4 py-2 text-sm text-[#7D8590] hover:text-[#E6EDF3] transition-colors">Cancel</button>
              <button
                onClick={() => void handleImport()}
                disabled={importRunning || !importJson.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0078D4] text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {importRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Import
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Import from Tenant Modal */}
      {showFromClientModal && (
        <Modal title="Import from Tenant" onClose={() => { setShowFromClientModal(false); setFromClientSearch(""); setFromClientId(""); setFromClientName(""); }} wide>
          <div className="space-y-4">
            <p className="text-sm text-[#7D8590]">
              Select a client to pull their most recent script run results. A simulation profile will be created from the merged <code className="text-xs bg-[#1C2128] px-1 rounded">profileUpdates</code> and <code className="text-xs bg-[#1C2128] px-1 rounded">parsedFindings</code> across all completed runs.
            </p>

            <div>
              <label className="block text-xs text-[#7D8590] mb-1.5">Search client</label>
              <input
                value={fromClientSearch}
                onChange={e => { setFromClientSearch(e.target.value); setFromClientId(""); setFromClientName(""); }}
                placeholder="Name, email, or company…"
                className="w-full border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
              />
            </div>

            {fromClientSearch && (
              <div className="border border-[#30363D] rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                {clientsWithRuns
                  .filter(c =>
                    c.email.toLowerCase().includes(fromClientSearch.toLowerCase()) ||
                    (c.name ?? "").toLowerCase().includes(fromClientSearch.toLowerCase()) ||
                    (c.company ?? "").toLowerCase().includes(fromClientSearch.toLowerCase())
                  )
                  .slice(0, 20)
                  .map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setFromClientId(String(c.id)); setFromClientName(c.name ?? c.email); setFromClientSearch(`${c.name ?? c.email}${c.company ? ` (${c.company})` : ""}`); }}
                      className={`w-full text-left px-4 py-2.5 text-sm border-b border-[#30363D]/50 last:border-0 transition-colors ${fromClientId === String(c.id) ? "bg-[#0078D4]/10 text-[#0078D4]" : "text-[#C9D1D9] hover:bg-[#1C2128]"}`}
                    >
                      <span className="font-medium">{c.name ?? "—"}</span>
                      <span className="text-[#7D8590] ml-2">{c.email}</span>
                      {c.company && <span className="text-[#484F58] ml-1">· {c.company}</span>}
                      <span className="ml-2 text-xs text-[#484F58]">{c.runCount} run{c.runCount !== 1 ? "s" : ""}</span>
                    </button>
                  ))}
                {clientsWithRuns.filter(c =>
                  c.email.toLowerCase().includes(fromClientSearch.toLowerCase()) ||
                  (c.name ?? "").toLowerCase().includes(fromClientSearch.toLowerCase()) ||
                  (c.company ?? "").toLowerCase().includes(fromClientSearch.toLowerCase())
                ).length === 0 && (
                  <p className="px-4 py-3 text-sm text-[#7D8590]">No clients with completed script runs found.</p>
                )}
              </div>
            )}

            {!fromClientSearch && clientsWithRuns.length > 0 && (
              <div className="border border-[#30363D] rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                {clientsWithRuns.slice(0, 10).map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setFromClientId(String(c.id)); setFromClientName(c.name ?? c.email); setFromClientSearch(`${c.name ?? c.email}${c.company ? ` (${c.company})` : ""}`); }}
                    className={`w-full text-left px-4 py-2.5 text-sm border-b border-[#30363D]/50 last:border-0 transition-colors ${fromClientId === String(c.id) ? "bg-[#0078D4]/10 text-[#0078D4]" : "text-[#C9D1D9] hover:bg-[#1C2128]"}`}
                  >
                    <span className="font-medium">{c.name ?? "—"}</span>
                    <span className="text-[#7D8590] ml-2">{c.email}</span>
                    {c.company && <span className="text-[#484F58] ml-1">· {c.company}</span>}
                    <span className="ml-2 text-xs text-[#484F58]">{c.runCount} run{c.runCount !== 1 ? "s" : ""} · last {new Date(c.lastRunAt).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            )}

            {!fromClientSearch && clientsWithRuns.length === 0 && (
              <p className="text-sm text-[#7D8590] italic">No clients with completed script runs found. Run some assessment scripts first.</p>
            )}

            {fromClientId && (
              <div className="flex items-center gap-2 p-3 bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-lg">
                <Check className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                <p className="text-sm text-[#C9D1D9]">
                  Will create a simulation profile from <strong className="text-[#E6EDF3]">{fromClientName}</strong>'s script run history.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => { setShowFromClientModal(false); setFromClientSearch(""); setFromClientId(""); setFromClientName(""); }}
                className="px-4 py-2 text-sm text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleImportFromClient()}
                disabled={importingFromClient || !fromClientId}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0078D4] text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
              >
                {importingFromClient ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                {importingFromClient ? "Importing…" : "Create Profile"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className={`bg-[#161B22] rounded-2xl shadow-2xl border border-[#30363D] flex flex-col w-full ${wide ? "max-w-4xl" : "max-w-xl"} max-h-[90vh]`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363D] flex-shrink-0">
          <h3 className="text-base font-bold text-[#E6EDF3]">{title}</h3>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}

function RuleRow({
  rule, conflictRuleIds, conflicts, editingRuleId, editRuleForm, setEditRuleForm, setEditingRuleId,
  deletingRuleId, savingRule, onEdit, onSave, onDelete,
}: {
  rule: SignalRule;
  conflictRuleIds: Set<number>;
  conflicts: Conflict[];
  editingRuleId: number | null;
  editRuleForm: { ruleType: string; sourceKey: string; compareValue: string; description: string };
  setEditRuleForm: (f: typeof editRuleForm) => void;
  setEditingRuleId: (id: number | null) => void;
  deletingRuleId: number | null;
  savingRule: boolean;
  onEdit: (r: SignalRule) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const isConflict = conflictRuleIds.has(rule.id);
  const conflictText = conflicts.find(c => c.ruleIds.includes(rule.id))?.description;
  const isEditing = editingRuleId === rule.id;

  if (isEditing) {
    return (
      <div className="px-4 py-3 bg-[#1C2128] space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select
            value={editRuleForm.ruleType}
            onChange={e => setEditRuleForm({ ...editRuleForm, ruleType: e.target.value })}
            className="border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2 py-1 text-xs"
          >
            {RULE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            value={editRuleForm.sourceKey}
            onChange={e => setEditRuleForm({ ...editRuleForm, sourceKey: e.target.value })}
            className="border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2 py-1 text-xs font-mono"
            placeholder="Source key"
          />
        </div>
        {needsCompareValue(editRuleForm.ruleType) && (
          <input
            value={editRuleForm.compareValue}
            onChange={e => setEditRuleForm({ ...editRuleForm, compareValue: e.target.value })}
            className="border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2 py-1 text-xs font-mono w-32"
            placeholder="Value"
          />
        )}
        <input
          value={editRuleForm.description}
          onChange={e => setEditRuleForm({ ...editRuleForm, description: e.target.value })}
          className="border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] rounded px-2 py-1 text-xs w-full"
          placeholder="Description"
        />
        <div className="flex gap-2">
          <button onClick={onSave} disabled={savingRule} className="px-3 py-1 bg-[#0078D4] text-white text-xs rounded hover:bg-[#0078D4]/90 disabled:opacity-50">
            {savingRule ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
          </button>
          <button onClick={() => setEditingRuleId(null)} className="px-3 py-1 bg-[#1C2128] text-[#7D8590] text-xs rounded hover:text-[#E6EDF3]">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 group">
      {ruleTypePill(rule.ruleType)}
      <code className="text-xs text-[#C9D1D9] font-mono flex-1 truncate">{rule.sourceKey}</code>
      {rule.compareValue && (
        <code className="text-xs text-[#7D8590] font-mono">{rule.compareValue}</code>
      )}
      {rule.description && <p className="text-xs text-[#484F58] truncate max-w-32">{rule.description}</p>}
      {isConflict && (
        <span className="cursor-help" title={conflictText}>
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        </span>
      )}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
        <button onClick={() => onEdit(rule)} className="p-1 text-[#7D8590] hover:text-[#0078D4] transition-colors">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} disabled={deletingRuleId === rule.id} className="p-1 text-[#7D8590] hover:text-red-500 transition-colors">
          {deletingRuleId === rule.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}
