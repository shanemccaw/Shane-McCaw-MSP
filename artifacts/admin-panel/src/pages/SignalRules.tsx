import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Layers,
  ListFilter,
  History,
  RotateCcw,
  Save,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import BundleImportExport from "@/components/signal-rules/BundleImportExport";
import EvaluatePreviewTester from "@/components/signal-rules/EvaluatePreviewTester";
import RuleGroupsAndSignalsManager from "@/components/signal-rules/RuleGroupsAndSignalsManager";
import ConflictsHealthPanel from "@/components/signal-rules/ConflictsHealthPanel";
import SimulationProfilesManager from "@/components/signal-rules/SimulationProfilesManager";

// ─── API shapes (match artifacts/api-server/src/routes/admin-signal-rules.ts) ──
// NOTE: licensingImpact exists in the DB but the admin API neither returns nor
// accepts it, so it is deliberately absent here.

interface SignalIntelligenceFields {
  priority: number;
  weight: number;
  pricingImpact: number;
  priorityScoreContribution: number;
  pricingValueContribution: number;
  governanceImpact: number;
  securityImpact: number;
  complianceImpact: number;
  adoptionImpact: number;
  copilotImpact: number;
  architectureImpact: number;
  trendValue: number;
  trendDirection: string;
  decayRate: number;
  ttlDays: number;
  confidence: number;
  severity: string;
  category: string;
  pillar: string;
  crmFitContribution: number;
  crmPainContribution: number;
  crmMaturityContribution: number;
  crmIntentContribution: number;
  crmUrgencyContribution: number;
}

interface SignalRule extends Partial<SignalIntelligenceFields> {
  id: number;
  signalKey: string;
  groupId: number | null;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string | null;
  sortOrder: number;
}

interface SignalGroup extends Partial<SignalIntelligenceFields> {
  id: number;
  signalKey: string;
  logic: "AND" | "OR";
  label: string | null;
  sortOrder: number;
}

interface RuleConflict {
  ruleIds: number[];
  description: string;
}

// Whole-ruleset snapshots (signal_rule_versions) — NOT per-rule history. A
// version captures every platform-owned rule + group at save time; restoring
// one replaces the ENTIRE current platform rule set (MSP overrides untouched).
interface RuleVersion {
  id: number;
  name: string;
  ruleCount: number;
  createdByAdminId: number | null;
  createdAt: string;
}

interface AuditLogEntry {
  id: number;
  action: string;
  signalKey: string | null;
  ruleId: number | null;
  note: string | null;
  adminUserId: number | null;
  createdAt: string;
}

// ─── Rule-type metadata ───────────────────────────────────────────────────────
// The evaluator (api-server lib/tenant-signals.ts evaluateRule) recognizes
// exactly these seven types. compareValue is only read by eq/gt/lt/threshold.

const RULE_TYPES: Array<{
  value: string;
  label: string;
  sourceKeyLabel: string;
  compare: null | { label: string; hint: string };
}> = [
  { value: "profile_key_truthy", label: "Profile key is truthy", sourceKeyLabel: "Profile field path", compare: null },
  { value: "profile_key_falsy", label: "Profile key is falsy", sourceKeyLabel: "Profile field path", compare: null },
  { value: "profile_key_eq", label: "Profile key equals", sourceKeyLabel: "Profile field path", compare: { label: "Compare value", hint: "String equality" } },
  { value: "profile_key_gt", label: "Profile key greater than", sourceKeyLabel: "Profile field path", compare: { label: "Compare value", hint: "Numeric threshold" } },
  { value: "profile_key_lt", label: "Profile key less than", sourceKeyLabel: "Profile field path", compare: { label: "Compare value", hint: "Numeric threshold" } },
  { value: "threshold", label: "Monitor item-count threshold", sourceKeyLabel: "Monitor key", compare: { label: "Item count above", hint: "Fires when the monitor's item count exceeds this number" } },
  { value: "findings_keyword", label: "Findings keyword match", sourceKeyLabel: "Keyword", compare: null },
];

const ruleTypeMeta = (value: string) => RULE_TYPES.find(t => t.value === value);

// No endpoint serves these enums; values mirror SIGNAL_TREND_DIRECTIONS /
// SIGNAL_SEVERITIES in api-server lib/tenant-signals.ts (same convention as
// TenantSignals.tsx / EngineRuleEditor.tsx).
const TREND_DIRECTIONS = ["up", "down", "flat"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;

// ─── Intelligence form state (strings; blanks omitted from request bodies so
// PATCH merges against the stored row instead of clobbering it) ───────────────

type IntelForm = Record<string, string>;

const INTEL_NUMERIC_FIELDS = [
  "priority", "weight", "pricingImpact", "priorityScoreContribution", "pricingValueContribution",
  "governanceImpact", "securityImpact", "complianceImpact", "adoptionImpact", "copilotImpact",
  "architectureImpact", "trendValue", "decayRate", "ttlDays", "confidence",
  "crmFitContribution", "crmPainContribution", "crmMaturityContribution", "crmIntentContribution",
  "crmUrgencyContribution",
] as const;
const INTEL_TEXT_FIELDS = ["trendDirection", "severity", "category", "pillar"] as const;
// Shown inline in the form; everything else lives under "Advanced Scoring".
const INTEL_COMMON_FIELDS = new Set(["priority", "weight", "severity"]);

const EMPTY_INTEL: IntelForm = Object.fromEntries(
  [...INTEL_NUMERIC_FIELDS, ...INTEL_TEXT_FIELDS].map(f => [f, ""]),
);

function intelFromRow(row: Partial<SignalIntelligenceFields>): IntelForm {
  const out: IntelForm = { ...EMPTY_INTEL };
  for (const f of INTEL_NUMERIC_FIELDS) {
    const v = row[f as keyof SignalIntelligenceFields];
    if (v !== undefined && v !== null) out[f] = String(v);
  }
  for (const f of INTEL_TEXT_FIELDS) {
    const v = row[f as keyof SignalIntelligenceFields];
    if (v !== undefined && v !== null) out[f] = String(v);
  }
  return out;
}

const INTEL_TEXT_DEFAULTS: Record<(typeof INTEL_TEXT_FIELDS)[number], string> = {
  trendDirection: "flat",
  severity: "low",
  category: "",
  pillar: "",
};

/**
 * Blank fields are omitted on CREATE (backend applies its defaults) but sent
 * as explicit defaults on EDIT — the stored row always has concrete values, so
 * a blanked field / "(default: …)" selection unambiguously means "reset", and
 * omitting it would make the PATCH merge silently keep the old value.
 */
function intelToBody(form: IntelForm, opts?: { blankAsDefault?: boolean }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of INTEL_NUMERIC_FIELDS) {
    if (form[f] !== undefined && form[f].trim() !== "") out[f] = Number(form[f]);
    else if (opts?.blankAsDefault) out[f] = 0;
  }
  for (const f of INTEL_TEXT_FIELDS) {
    if (form[f] !== undefined && form[f].trim() !== "") out[f] = form[f].trim();
    else if (opts?.blankAsDefault) out[f] = INTEL_TEXT_DEFAULTS[f];
  }
  return out;
}

// ─── Rule / group form state ──────────────────────────────────────────────────

interface RuleForm {
  signalKey: string;
  groupId: string; // "" = ungrouped
  ruleType: string;
  sourceKey: string;
  compareValue: string;
  description: string;
  sortOrder: string;
  intel: IntelForm;
}

interface GroupForm {
  signalKey: string;
  logic: "AND" | "OR";
  label: string;
  sortOrder: string;
}

const emptyRuleForm = (signalKey = ""): RuleForm => ({
  signalKey,
  groupId: "",
  ruleType: "profile_key_truthy",
  sourceKey: "",
  compareValue: "",
  description: "",
  sortOrder: "0",
  intel: { ...EMPTY_INTEL },
});

const inputCls =
  "w-full border border-border bg-background text-foreground rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60";
const selectCls = inputCls;
const btnPrimaryCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors";
const btnGhostCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-xs font-semibold rounded-lg border border-border hover:border-primary/40 disabled:opacity-40 transition-colors";

export default function SignalRulesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [bySignal, setBySignal] = useState<Record<string, { rules: SignalRule[]; groups: SignalGroup[] }>>({});
  const [loading, setLoading] = useState(true);
  const [collapsedSignals, setCollapsedSignals] = useState<Record<string, boolean>>({});

  // Rule modal state (create + edit share one form).
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<SignalRule | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>(emptyRuleForm());
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleConflicts, setRuleConflicts] = useState<RuleConflict[] | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Group modal state.
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SignalGroup | null>(null);
  const [groupForm, setGroupForm] = useState<GroupForm>({ signalKey: "", logic: "OR", label: "", sortOrder: "0" });
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  // Rules | Version History | Audit Log | Bundle Import/Export | Evaluate/Preview | Groups & Signals | Conflicts & Health | Simulation Profiles tabs (mirrors TenantSignals.tsx's tab-row pattern).
  const [activeTab, setActiveTab] = useState<"rules" | "versions" | "audit" | "bundle" | "evaluate" | "groups" | "health" | "simulation">("rules");

  // Version History (whole-ruleset snapshots).
  const [versions, setVersions] = useState<RuleVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [snapshotSaving, setSnapshotSaving] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<RuleVersion | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);

  // Audit Log.
  const [auditRows, setAuditRows] = useState<AuditLogEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSignalFilter, setAuditSignalFilter] = useState("");
  const [auditOffset, setAuditOffset] = useState(0);
  const AUDIT_PAGE_SIZE = 50;

  const loadData = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load signal rules");
      setBySignal(data.bySignal ?? {});
    } catch (err) {
      toast({
        title: "Failed to load signal rules",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules/versions");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load versions");
      setVersions(Array.isArray(data) ? data : []);
    } catch (err) {
      toast({
        title: "Failed to load version history",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setVersionsLoading(false);
    }
  }, [fetchWithAuth, toast]);

  const loadAuditLog = useCallback(async (signalKey: string, offset: number) => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE), offset: String(offset) });
      if (signalKey) params.set("signalKey", signalKey);
      const res = await fetchWithAuth(`/api/admin/signal-rules/audit-log?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load audit log");
      setAuditRows(Array.isArray(data.rows) ? data.rows : []);
      setAuditTotal(typeof data.total === "number" ? data.total : 0);
    } catch (err) {
      toast({
        title: "Failed to load audit log",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setAuditLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => {
    if (activeTab === "versions") void loadVersions();
  }, [activeTab, loadVersions]);

  useEffect(() => {
    if (activeTab === "audit") void loadAuditLog(auditSignalFilter, auditOffset);
  }, [activeTab, auditSignalFilter, auditOffset, loadAuditLog]);

  const handleSaveSnapshot = async () => {
    if (!snapshotName.trim()) return;
    setSnapshotSaving(true);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: snapshotName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save snapshot");
      toast({ title: "Snapshot saved" });
      setSnapshotModalOpen(false);
      setSnapshotName("");
      void loadVersions();
    } catch (err) {
      toast({
        title: "Failed to save snapshot",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSnapshotSaving(false);
    }
  };

  const handleRestoreVersion = async () => {
    if (!restoringVersion) return;
    setRestoring(true);
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rules/versions/${restoringVersion.id}/restore`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to restore version");
      toast({
        title: "Version restored",
        description: `${data.restored} rule(s) restored. Prior state saved as snapshot #${data.backupSnapshotId}.`,
      });
      setRestoringVersion(null);
      setRestoreConfirmText("");
      void loadVersions();
      void loadData();
    } catch (err) {
      toast({
        title: "Failed to restore version",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRestoring(false);
    }
  };

  // Built-in/custom keys alphabetically, seeded example:* taxonomy keys last.
  const signalKeys = useMemo(() => {
    const keys = Object.keys(bySignal);
    const normal = keys.filter(k => !k.startsWith("example:")).sort();
    const examples = keys.filter(k => k.startsWith("example:")).sort();
    return [...normal, ...examples];
  }, [bySignal]);

  const openCreateRule = (signalKey: string) => {
    setEditingRule(null);
    setRuleForm(emptyRuleForm(signalKey));
    setRuleConflicts(null);
    setRuleError(null);
    setAdvancedOpen(false);
    setRuleModalOpen(true);
  };

  const openEditRule = (rule: SignalRule) => {
    setEditingRule(rule);
    setRuleForm({
      signalKey: rule.signalKey,
      groupId: rule.groupId != null ? String(rule.groupId) : "",
      ruleType: rule.ruleType,
      sourceKey: rule.sourceKey,
      compareValue: rule.compareValue ?? "",
      description: rule.description ?? "",
      sortOrder: String(rule.sortOrder),
      intel: intelFromRow(rule),
    });
    setRuleConflicts(null);
    setRuleError(null);
    setAdvancedOpen(false);
    setRuleModalOpen(true);
  };

  const handleRuleSave = async () => {
    if (!ruleForm.signalKey || !ruleForm.ruleType || !ruleForm.sourceKey.trim()) {
      setRuleError("Signal, rule type, and source key are required.");
      return;
    }
    setRuleSaving(true);
    setRuleConflicts(null);
    setRuleError(null);
    const meta = ruleTypeMeta(ruleForm.ruleType);
    const body: Record<string, unknown> = {
      signalKey: ruleForm.signalKey,
      ruleType: ruleForm.ruleType,
      sourceKey: ruleForm.sourceKey.trim(),
      // For unrecognized rule types (e.g. seeded example:* rows) the key is
      // omitted entirely: PATCH preserves the stored compareValue when the key
      // is absent, and nulling it here would silently destroy it.
      ...(meta ? { compareValue: meta.compare ? ruleForm.compareValue.trim() || null : null } : {}),
      description: ruleForm.description.trim() || null,
      groupId: ruleForm.groupId ? Number(ruleForm.groupId) : null,
      sortOrder: Number(ruleForm.sortOrder) || 0,
      ...intelToBody(ruleForm.intel, { blankAsDefault: !!editingRule }),
    };
    try {
      const res = await fetchWithAuth(
        editingRule ? `/api/admin/signal-rules/${editingRule.id}` : "/api/admin/signal-rules",
        {
          method: editingRule ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (res.status === 422) {
        // Save REJECTED — surface each conflict's human-readable description.
        setRuleConflicts((data.conflicts ?? []) as RuleConflict[]);
        setRuleError(data.error ?? "This change conflicts with existing rules and was not saved.");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to save rule");
      toast({ title: editingRule ? "Rule updated" : "Rule created" });
      setRuleModalOpen(false);
      void loadData();
    } catch (err) {
      setRuleError(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setRuleSaving(false);
    }
  };

  const handleRuleDelete = async (rule: SignalRule) => {
    if (!confirm(`Delete this ${rule.ruleType} rule on "${rule.sourceKey}"? This cannot be undone.`)) return;
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rules/${rule.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete rule");
      toast({ title: "Rule deleted" });
      void loadData();
    } catch (err) {
      toast({
        title: "Failed to delete rule",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const openCreateGroup = (signalKey: string) => {
    setEditingGroup(null);
    setGroupForm({ signalKey, logic: "OR", label: "", sortOrder: "0" });
    setGroupError(null);
    setGroupModalOpen(true);
  };

  const openEditGroup = (group: SignalGroup) => {
    setEditingGroup(group);
    setGroupForm({
      signalKey: group.signalKey,
      logic: group.logic,
      label: group.label ?? "",
      sortOrder: String(group.sortOrder),
    });
    setGroupError(null);
    setGroupModalOpen(true);
  };

  const handleGroupSave = async () => {
    if (!groupForm.signalKey) {
      setGroupError("Signal is required.");
      return;
    }
    setGroupSaving(true);
    setGroupError(null);
    const body: Record<string, unknown> = {
      signalKey: groupForm.signalKey,
      logic: groupForm.logic,
      label: groupForm.label.trim() || null,
      sortOrder: Number(groupForm.sortOrder) || 0,
    };
    try {
      const res = await fetchWithAuth(
        editingGroup ? `/api/admin/signal-rule-groups/${editingGroup.id}` : "/api/admin/signal-rule-groups",
        {
          method: editingGroup ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save group");
      toast({ title: editingGroup ? "Group updated" : "Group created" });
      setGroupModalOpen(false);
      void loadData();
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : "Failed to save group");
    } finally {
      setGroupSaving(false);
    }
  };

  const handleGroupDelete = async (group: SignalGroup) => {
    if (!confirm(`Delete group "${group.label ?? `#${group.id}`}"? Its rules are kept and become ungrouped (each can then fire the signal on its own).`)) return;
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rule-groups/${group.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete group");
      toast({ title: "Group deleted", description: "Member rules are now ungrouped." });
      void loadData();
    } catch (err) {
      toast({
        title: "Failed to delete group",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const currentRuleTypeMeta = ruleTypeMeta(ruleForm.ruleType);
  const groupsForFormSignal = bySignal[ruleForm.signalKey]?.groups ?? [];

  const renderRuleRow = (rule: SignalRule) => {
    const meta = ruleTypeMeta(rule.ruleType);
    return (
      <div
        key={rule.id}
        className="flex items-center gap-3 px-3 py-2 border-b border-border/60 last:border-b-0 hover:bg-accent/50 group"
      >
        <span className="shrink-0 rounded bg-primary/10 border border-primary/25 px-1.5 py-0.5 text-[10px] font-mono text-primary" title={meta ? undefined : "Unknown rule type — never fires"}>
          {rule.ruleType}
          {!meta && <AlertTriangle className="ml-1 inline h-3 w-3 text-amber-400" />}
        </span>
        <span className="font-mono text-xs text-foreground truncate" title={rule.sourceKey}>
          {rule.sourceKey}
        </span>
        {rule.compareValue != null && rule.compareValue !== "" && (
          <span className="shrink-0 text-xs text-muted-foreground font-mono">= {rule.compareValue}</span>
        )}
        {rule.description && (
          <span className="text-[11px] text-muted-foreground truncate flex-1" title={rule.description}>
            {rule.description}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/60">#{rule.sortOrder}</span>
        <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => openEditRule(rule)} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent" title="Edit rule">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => void handleRuleDelete(rule)} className="rounded p-1 text-muted-foreground hover:text-red-400 hover:bg-accent" title="Delete rule">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-foreground text-xl font-semibold flex items-center gap-2">
            <ListFilter className="h-5 w-5 text-primary" />
            Signal Rules
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Derivation rules and rule groups per signal. Ungrouped rules fire the signal individually; a group fires
            when its AND/OR logic is satisfied. Conflicting saves are rejected with the specific conflict shown.
          </p>
        </div>
      </div>

      <div className="flex gap-0 border-b border-border">
        {(["rules", "versions", "audit", "bundle", "evaluate", "groups", "health", "simulation"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "versions" ? "Version History" : tab === "audit" ? "Audit Log" : tab === "bundle" ? "Bundle Import/Export" : tab === "evaluate" ? "Evaluate / Preview" : tab === "groups" ? "Groups & Signals" : tab === "health" ? "Conflicts & Health" : tab === "simulation" ? "Simulation Profiles" : "Rules"}
          </button>
        ))}
      </div>

      {activeTab === "bundle" && <BundleImportExport />}

      {activeTab === "evaluate" && <EvaluatePreviewTester />}

      {activeTab === "groups" && <RuleGroupsAndSignalsManager />}

      {activeTab === "health" && <ConflictsHealthPanel />}

      {activeTab === "simulation" && <SimulationProfilesManager />}

      {activeTab === "rules" && (loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading signal rules…
        </div>
      ) : (
        <div className="space-y-4">
          {signalKeys.map(signalKey => {
            const entry = bySignal[signalKey]!;
            const collapsed = collapsedSignals[signalKey] ?? false;
            const groupedRuleIds = new Set(entry.rules.filter(r => r.groupId != null).map(r => r.id));
            const ungrouped = entry.rules.filter(r => !groupedRuleIds.has(r.id) || r.groupId == null).filter(r => r.groupId == null);
            return (
              <div key={signalKey} className="bg-card border border-border rounded-lg overflow-hidden">
                <div
                  className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-accent/60"
                  onClick={() => setCollapsedSignals(prev => ({ ...prev, [signalKey]: !collapsed }))}
                >
                  {collapsed ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="font-mono text-sm text-foreground">{signalKey}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {entry.rules.length} rule{entry.rules.length !== 1 ? "s" : ""}
                    {entry.groups.length > 0 && `, ${entry.groups.length} group${entry.groups.length !== 1 ? "s" : ""}`}
                  </span>
                  <div className="ml-auto flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    <button onClick={() => openCreateGroup(signalKey)} className={btnGhostCls} title="Add a rule group to this signal">
                      <Layers className="h-3.5 w-3.5" /> Group
                    </button>
                    <button onClick={() => openCreateRule(signalKey)} className={btnGhostCls} title="Add a rule to this signal">
                      <Plus className="h-3.5 w-3.5" /> Rule
                    </button>
                  </div>
                </div>

                {!collapsed && (
                  <div className="border-t border-border">
                    {entry.rules.length === 0 && entry.groups.length === 0 ? (
                      <div className="px-4 py-3 text-xs italic text-muted-foreground/70">No rules yet</div>
                    ) : (
                      <div className="p-3 space-y-3">
                        {entry.groups.map(group => {
                          const memberRules = entry.rules.filter(r => r.groupId === group.id);
                          return (
                            <div key={group.id} className="rounded-lg border border-border bg-background/40">
                              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 group">
                                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${
                                  group.logic === "AND"
                                    ? "bg-amber-400/10 text-amber-400 border border-amber-400/25"
                                    : "bg-emerald-400/10 text-emerald-400 border border-emerald-400/25"
                                }`}>
                                  {group.logic}
                                </span>
                                <span className="text-xs text-foreground/90 font-medium truncate">
                                  {group.label ?? `Group #${group.id}`}
                                </span>
                                <span className="text-[10px] text-muted-foreground/60">
                                  {memberRules.length} rule{memberRules.length !== 1 ? "s" : ""} · #{group.sortOrder}
                                </span>
                                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => openEditGroup(group)} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent" title="Edit group">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => void handleGroupDelete(group)} className="rounded p-1 text-muted-foreground hover:text-red-400 hover:bg-accent" title="Delete group (rules become ungrouped)">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                              {memberRules.length === 0 ? (
                                <div className="px-3 py-2 text-[11px] italic text-muted-foreground/70">Empty group — never fires</div>
                              ) : (
                                memberRules.map(renderRuleRow)
                              )}
                            </div>
                          );
                        })}

                        {ungrouped.length > 0 && (
                          <div className="rounded-lg border border-border bg-background/40">
                            <div className="px-3 py-1.5 border-b border-border/60 text-[11px] text-muted-foreground">
                              Ungrouped — any single rule fires the signal
                            </div>
                            {ungrouped.map(renderRuleRow)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* ── Version History tab ── */}
      {activeTab === "versions" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground max-w-xl">
              Snapshots of the entire platform rule set (all signals). Restoring a version replaces every current
              platform-owned rule and group with that snapshot's — MSP-owned overrides are never touched. A backup
              snapshot is always taken automatically right before a restore.
            </p>
            <button
              onClick={() => { setSnapshotName(""); setSnapshotModalOpen(true); }}
              className={btnPrimaryCls}
            >
              <Save className="h-3.5 w-3.5" /> Save Snapshot
            </button>
          </div>

          {versionsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading version history…
            </div>
          ) : versions.length === 0 ? (
            <div className="px-4 py-3 text-xs italic text-muted-foreground/70">
              No snapshots yet. Import/restore operations auto-save a backup here; you can also save one manually.
            </div>
          ) : (
            <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border/60">
              {versions.map(v => (
                <div key={v.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/40">
                  <History className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm text-foreground font-medium truncate">{v.name}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {v.ruleCount} rule{v.ruleCount !== 1 ? "s" : ""}
                  </span>
                  <span className="text-[11px] text-muted-foreground/60 shrink-0">
                    {v.createdByAdminId != null ? `admin #${v.createdByAdminId}` : "system"}
                  </span>
                  <span className="ml-auto text-[11px] text-muted-foreground/60 shrink-0">
                    {new Date(v.createdAt).toLocaleString()}
                  </span>
                  <button
                    onClick={() => { setRestoringVersion(v); setRestoreConfirmText(""); }}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
                    title="Restore this version (overwrites current live rules)"
                  >
                    <RotateCcw className="h-3 w-3" /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Audit Log tab ── */}
      {activeTab === "audit" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-[11px] font-medium text-muted-foreground">Signal</label>
            <select
              className={`${selectCls} max-w-xs`}
              value={auditSignalFilter}
              onChange={e => { setAuditSignalFilter(e.target.value); setAuditOffset(0); }}
            >
              <option value="">All signals</option>
              {signalKeys.map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          {auditLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading audit log…
            </div>
          ) : auditRows.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No audit log entries yet.</p>
          ) : (
            <div className="space-y-2">
              {auditRows.map(entry => (
                <div key={entry.id} className="flex items-start gap-3 p-3 bg-card rounded-lg border border-border">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${
                    entry.action === "create" ? "bg-green-900/30 text-green-400" :
                    entry.action === "delete" ? "bg-red-900/30 text-red-400" :
                    entry.action === "import" || entry.action === "import_bundle" ? "bg-blue-900/30 text-blue-400" :
                    entry.action === "restore_version" ? "bg-purple-900/30 text-purple-400" :
                    "bg-border text-muted-foreground"
                  }`}>{entry.action}</span>
                  <div className="flex-1 min-w-0">
                    {entry.note && <p className="text-xs text-foreground/90">{entry.note}</p>}
                    <p className="text-[11px] text-muted-foreground">
                      {entry.signalKey && <span className="font-mono">{entry.signalKey}</span>}
                      {entry.ruleId && <span>{entry.signalKey ? " · " : ""}Rule #{entry.ruleId}</span>}
                      {entry.adminUserId != null && <span>{(entry.signalKey || entry.ruleId) ? " · " : ""}admin #{entry.adminUserId}</span>}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground/60 flex-shrink-0">{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {auditTotal > 0
                ? `Showing ${auditOffset + 1}–${Math.min(auditOffset + AUDIT_PAGE_SIZE, auditTotal)} of ${auditTotal}`
                : null}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setAuditOffset(o => Math.max(0, o - AUDIT_PAGE_SIZE))}
                disabled={auditOffset === 0 || auditLoading}
                className={btnGhostCls}
              >
                Previous
              </button>
              <button
                onClick={() => setAuditOffset(o => o + AUDIT_PAGE_SIZE)}
                disabled={auditOffset + AUDIT_PAGE_SIZE >= auditTotal || auditLoading}
                className={btnGhostCls}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Save Snapshot modal ── */}
      {snapshotModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !snapshotSaving && setSnapshotModalOpen(false)}>
          <div
            className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md mx-4 p-6"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-foreground mb-4">Save Snapshot</h2>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name</label>
            <input
              className={inputCls}
              value={snapshotName}
              autoFocus
              onChange={e => setSnapshotName(e.target.value)}
              placeholder="e.g. Before Q3 pricing rework"
            />
            <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
              <button onClick={() => setSnapshotModalOpen(false)} disabled={snapshotSaving} className={btnGhostCls}>
                Cancel
              </button>
              <button onClick={() => void handleSaveSnapshot()} disabled={snapshotSaving || !snapshotName.trim()} className={btnPrimaryCls}>
                {snapshotSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save Snapshot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Restore version confirmation modal ── */}
      {restoringVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !restoring && setRestoringVersion(null)}>
          <div
            className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md mx-4 p-6"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> Restore "{restoringVersion.name}"?
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              This overwrites every current platform-owned signal rule and group with the {restoringVersion.ruleCount}{" "}
              rule{restoringVersion.ruleCount !== 1 ? "s" : ""} captured in this snapshot ({new Date(restoringVersion.createdAt).toLocaleString()}).
              MSP-owned overrides are not affected. The current state is backed up automatically before this runs.
            </p>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              Type <span className="font-mono text-foreground">RESTORE</span> to confirm
            </label>
            <input
              className={inputCls}
              value={restoreConfirmText}
              autoFocus
              onChange={e => setRestoreConfirmText(e.target.value)}
              placeholder="RESTORE"
            />
            <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
              <button onClick={() => setRestoringVersion(null)} disabled={restoring} className={btnGhostCls}>
                Cancel
              </button>
              <button
                onClick={() => void handleRestoreVersion()}
                disabled={restoring || restoreConfirmText !== "RESTORE"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors"
              >
                {restoring && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rule create/edit modal ── */}
      {ruleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !ruleSaving && setRuleModalOpen(false)}>
          <div
            className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-foreground mb-4">
              {editingRule ? "Edit Rule" : "New Rule"}
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Signal</label>
                <select
                  className={selectCls}
                  value={ruleForm.signalKey}
                  disabled={!!editingRule}
                  onChange={e => setRuleForm(f => ({ ...f, signalKey: e.target.value, groupId: "" }))}
                >
                  <option value="">Select a signal…</option>
                  {signalKeys.map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Rule group</label>
                <select
                  className={selectCls}
                  value={ruleForm.groupId}
                  onChange={e => setRuleForm(f => ({ ...f, groupId: e.target.value }))}
                >
                  <option value="">Ungrouped</option>
                  {groupsForFormSignal.map(g => (
                    <option key={g.id} value={String(g.id)}>
                      {g.label ?? `Group #${g.id}`} ({g.logic})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Rule type</label>
                <select
                  className={selectCls}
                  value={ruleForm.ruleType}
                  onChange={e => setRuleForm(f => ({ ...f, ruleType: e.target.value }))}
                >
                  {editingRule && !ruleTypeMeta(editingRule.ruleType) && (
                    <option value={editingRule.ruleType}>
                      {editingRule.ruleType} (unrecognized — never fires)
                    </option>
                  )}
                  {RULE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  {currentRuleTypeMeta?.sourceKeyLabel ?? "Source key"}
                </label>
                <input
                  className={inputCls}
                  value={ruleForm.sourceKey}
                  onChange={e => setRuleForm(f => ({ ...f, sourceKey: e.target.value }))}
                  placeholder={ruleForm.ruleType === "findings_keyword" ? "e.g. legacy auth" : "e.g. securityDefaults.isEnabled"}
                />
              </div>
              {currentRuleTypeMeta?.compare && (
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    {currentRuleTypeMeta.compare.label}
                    <span className="ml-1 text-muted-foreground/60">({currentRuleTypeMeta.compare.hint})</span>
                  </label>
                  <input
                    className={inputCls}
                    value={ruleForm.compareValue}
                    onChange={e => setRuleForm(f => ({ ...f, compareValue: e.target.value }))}
                  />
                </div>
              )}
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Sort order</label>
                <input
                  type="number"
                  className={inputCls}
                  value={ruleForm.sortOrder}
                  onChange={e => setRuleForm(f => ({ ...f, sortOrder: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Description</label>
                <input
                  className={inputCls}
                  value={ruleForm.description}
                  onChange={e => setRuleForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Why this rule exists"
                />
              </div>

              {/* Common intelligence fields, inline */}
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Priority</label>
                <input
                  type="number"
                  className={inputCls}
                  value={ruleForm.intel.priority}
                  placeholder="0"
                  onChange={e => setRuleForm(f => ({ ...f, intel: { ...f.intel, priority: e.target.value } }))}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Weight</label>
                <input
                  type="number"
                  className={inputCls}
                  value={ruleForm.intel.weight}
                  placeholder="0"
                  onChange={e => setRuleForm(f => ({ ...f, intel: { ...f.intel, weight: e.target.value } }))}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Severity</label>
                <select
                  className={selectCls}
                  value={ruleForm.intel.severity}
                  onChange={e => setRuleForm(f => ({ ...f, intel: { ...f.intel, severity: e.target.value } }))}
                >
                  <option value="">(default: low)</option>
                  {SEVERITIES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Advanced Scoring — the rest of the intelligence fields, collapsed */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="mt-4">
              <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Advanced Scoring
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 grid grid-cols-3 gap-3 rounded-lg border border-border bg-background/40 p-3">
                  {INTEL_NUMERIC_FIELDS.filter(f => !INTEL_COMMON_FIELDS.has(f)).map(f => (
                    <div key={f}>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">{f}</label>
                      <input
                        type="number"
                        className={inputCls}
                        value={ruleForm.intel[f]}
                        placeholder="0"
                        onChange={e => setRuleForm(prev => ({ ...prev, intel: { ...prev.intel, [f]: e.target.value } }))}
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">trendDirection</label>
                    <select
                      className={selectCls}
                      value={ruleForm.intel.trendDirection}
                      onChange={e => setRuleForm(prev => ({ ...prev, intel: { ...prev.intel, trendDirection: e.target.value } }))}
                    >
                      <option value="">(default: flat)</option>
                      {TREND_DIRECTIONS.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">category</label>
                    <input
                      className={inputCls}
                      value={ruleForm.intel.category}
                      onChange={e => setRuleForm(prev => ({ ...prev, intel: { ...prev.intel, category: e.target.value } }))}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">pillar</label>
                    <input
                      className={inputCls}
                      value={ruleForm.intel.pillar}
                      onChange={e => setRuleForm(prev => ({ ...prev, intel: { ...prev.intel, pillar: e.target.value } }))}
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {(ruleError || (ruleConflicts && ruleConflicts.length > 0)) && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <div className="flex items-center gap-2 font-semibold mb-1">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {ruleError ?? "Save rejected due to rule conflicts"}
                </div>
                {ruleConflicts && ruleConflicts.length > 0 && (
                  <ul className="list-disc pl-5 space-y-0.5">
                    {ruleConflicts.map((c, i) => (
                      <li key={i}>
                        {c.description}
                        {c.ruleIds.length > 0 && (
                          <span className="text-amber-300/60"> (rule id{c.ruleIds.length !== 1 ? "s" : ""}: {c.ruleIds.join(", ")})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
              <button onClick={() => setRuleModalOpen(false)} disabled={ruleSaving} className={btnGhostCls}>
                Cancel
              </button>
              <button onClick={() => void handleRuleSave()} disabled={ruleSaving} className={btnPrimaryCls}>
                {ruleSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingRule ? "Save Changes" : "Create Rule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Group create/edit modal ── */}
      {groupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !groupSaving && setGroupModalOpen(false)}>
          <div
            className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md mx-4 p-6"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-foreground mb-4">
              {editingGroup ? "Edit Rule Group" : "New Rule Group"}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Signal</label>
                <select
                  className={selectCls}
                  value={groupForm.signalKey}
                  disabled={!!editingGroup}
                  onChange={e => setGroupForm(f => ({ ...f, signalKey: e.target.value }))}
                >
                  <option value="">Select a signal…</option>
                  {signalKeys.map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Logic</label>
                <select
                  className={selectCls}
                  value={groupForm.logic}
                  onChange={e => setGroupForm(f => ({ ...f, logic: e.target.value as "AND" | "OR" }))}
                >
                  <option value="OR">OR — any member rule fires the signal</option>
                  <option value="AND">AND — every member rule must pass</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Label</label>
                <input
                  className={inputCls}
                  value={groupForm.label}
                  onChange={e => setGroupForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="Optional group label"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Sort order</label>
                <input
                  type="number"
                  className={inputCls}
                  value={groupForm.sortOrder}
                  onChange={e => setGroupForm(f => ({ ...f, sortOrder: e.target.value }))}
                />
              </div>
            </div>

            {groupError && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {groupError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
              <button onClick={() => setGroupModalOpen(false)} disabled={groupSaving} className={btnGhostCls}>
                Cancel
              </button>
              <button onClick={() => void handleGroupSave()} disabled={groupSaving} className={btnPrimaryCls}>
                {groupSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingGroup ? "Save Changes" : "Create Group"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
