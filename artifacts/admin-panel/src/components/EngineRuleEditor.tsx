import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Trash2, Pencil, AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ─── Types ───────────────────────────────────────────────────────────────────

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
  trendDirection: "up" | "down" | "flat";
  decayRate: number;
  ttlDays: number;
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
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

interface IntelFormFields {
  category: string; priority: string; weight: string;
  pricingImpact: string; priorityScoreContribution: string; pricingValueContribution: string;
  governanceImpact: string; securityImpact: string; complianceImpact: string;
  adoptionImpact: string; copilotImpact: string; architectureImpact: string;
  trendValue: string; trendDirection: string; decayRate: string; ttlDays: string;
  confidence: string; severity: string; pillar: string;
  crmFitContribution: string; crmPainContribution: string; crmMaturityContribution: string;
  crmIntentContribution: string; crmUrgencyContribution: string;
}

interface Conflict { ruleIds: number[]; description: string; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EMPTY_INTEL: IntelFormFields = {
  category: "", priority: "", weight: "", pricingImpact: "", priorityScoreContribution: "",
  pricingValueContribution: "", governanceImpact: "", securityImpact: "", complianceImpact: "",
  adoptionImpact: "", copilotImpact: "", architectureImpact: "", trendValue: "", trendDirection: "",
  decayRate: "", ttlDays: "", confidence: "", severity: "", pillar: "", crmFitContribution: "",
  crmPainContribution: "", crmMaturityContribution: "", crmIntentContribution: "", crmUrgencyContribution: "",
};

function intelFromRow(row: Partial<SignalIntelligenceFields>): IntelFormFields {
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    category: s(row.category), priority: s(row.priority), weight: s(row.weight),
    pricingImpact: s(row.pricingImpact), priorityScoreContribution: s(row.priorityScoreContribution),
    pricingValueContribution: s(row.pricingValueContribution), governanceImpact: s(row.governanceImpact),
    securityImpact: s(row.securityImpact), complianceImpact: s(row.complianceImpact),
    adoptionImpact: s(row.adoptionImpact), copilotImpact: s(row.copilotImpact),
    architectureImpact: s(row.architectureImpact), trendValue: s(row.trendValue),
    trendDirection: s(row.trendDirection), decayRate: s(row.decayRate), ttlDays: s(row.ttlDays),
    confidence: s(row.confidence), severity: s(row.severity), pillar: s(row.pillar),
    crmFitContribution: s(row.crmFitContribution), crmPainContribution: s(row.crmPainContribution),
    crmMaturityContribution: s(row.crmMaturityContribution), crmIntentContribution: s(row.crmIntentContribution),
    crmUrgencyContribution: s(row.crmUrgencyContribution),
  };
}

function intelToBody(f: IntelFormFields): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const n = (k: keyof IntelFormFields) => { if (f[k].trim()) body[k] = Number(f[k]); };
  const str = (k: keyof IntelFormFields) => { if (f[k].trim()) body[k] = f[k].trim(); };
  str("category"); n("priority"); n("weight");
  n("pricingImpact"); n("priorityScoreContribution"); n("pricingValueContribution");
  n("governanceImpact"); n("securityImpact"); n("complianceImpact");
  n("adoptionImpact"); n("copilotImpact"); n("architectureImpact");
  n("trendValue"); str("trendDirection"); n("decayRate"); n("ttlDays"); n("confidence");
  str("severity"); str("pillar");
  n("crmFitContribution"); n("crmPainContribution"); n("crmMaturityContribution");
  n("crmIntentContribution"); n("crmUrgencyContribution");
  return body;
}

function needsCompare(ruleType: string) {
  return ["profile_key_eq", "profile_key_gt", "profile_key_lt"].includes(ruleType);
}

const RULE_TYPES = [
  { value: "profile_key_truthy", label: "Is Truthy",    color: "bg-green-900/40 text-green-400" },
  { value: "profile_key_falsy",  label: "Is Falsy",     color: "bg-red-900/40 text-red-400" },
  { value: "profile_key_eq",     label: "Equals",       color: "bg-blue-900/40 text-blue-400" },
  { value: "profile_key_gt",     label: "Greater Than", color: "bg-purple-900/40 text-purple-400" },
  { value: "profile_key_lt",     label: "Less Than",    color: "bg-yellow-900/40 text-yellow-400" },
  { value: "findings_keyword",   label: "Keyword",      color: "bg-teal-900/40 text-teal-400" },
];

function RuleTypePill({ ruleType }: { ruleType: string }) {
  const opt = RULE_TYPES.find(o => o.value === ruleType);
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${opt?.color ?? "bg-border text-muted-foreground"}`}>
      {opt?.label ?? ruleType}
    </span>
  );
}

// ─── IntelligenceFieldsPanel ──────────────────────────────────────────────────

function IntelligenceFieldsPanel({ value, onChange }: { value: IntelFormFields; onChange: (f: IntelFormFields) => void }) {
  const set = <K extends keyof IntelFormFields>(k: K, v: string) => onChange({ ...value, [k]: v });
  const cls = "border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs font-mono w-full";
  const sel = "border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs w-full";
  const lbl = "block text-[10px] text-muted-foreground mb-0.5";
  const num = (k: keyof IntelFormFields, label: string, extra?: { step?: string; min?: string; max?: string }) => (
    <div><label className={lbl}>{label}</label><input type="number" step={extra?.step} min={extra?.min} max={extra?.max} value={value[k]} onChange={e => set(k, e.target.value)} className={cls} /></div>
  );
  return (
    <div className="space-y-2.5">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Core</p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={lbl}>Category</label>
            <input value={value.category} onChange={e => set("category", e.target.value)} placeholder="e.g. pricing:general" className={cls} />
          </div>
          <div>
            <label className={lbl}>Pillar</label>
            <input value={value.pillar} onChange={e => set("pillar", e.target.value)} placeholder="e.g. licensing" className={cls} />
          </div>
          <div>
            <label className={lbl}>Severity</label>
            <select value={value.severity} onChange={e => set("severity", e.target.value)} className={sel}>
              <option value="">— low —</option>
              <option value="low">low</option><option value="medium">medium</option>
              <option value="high">high</option><option value="critical">critical</option>
            </select>
          </div>
          {num("priority", "Priority")}
          {num("weight", "Weight")}
          {num("confidence", "Confidence")}
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Impact</p>
        <div className="grid grid-cols-3 gap-2">
          {num("pricingImpact", "Pricing")}
          {num("priorityScoreContribution", "Priority score")}
          {num("pricingValueContribution", "Pricing value")}
          {num("governanceImpact", "Governance")}
          {num("securityImpact", "Security")}
          {num("complianceImpact", "Compliance")}
          {num("adoptionImpact", "Adoption")}
          {num("copilotImpact", "Copilot")}
          {num("architectureImpact", "Architecture")}
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Trend</p>
        <div className="grid grid-cols-3 gap-2">
          {num("trendValue", "Trend value")}
          <div>
            <label className={lbl}>Direction</label>
            <select value={value.trendDirection} onChange={e => set("trendDirection", e.target.value)} className={sel}>
              <option value="">— flat —</option>
              <option value="up">up</option><option value="down">down</option><option value="flat">flat</option>
            </select>
          </div>
          {num("decayRate", "Decay rate (0–1)", { step: "0.01", min: "0", max: "1" })}
          {num("ttlDays", "TTL (days)")}
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">CRM</p>
        <div className="grid grid-cols-3 gap-2">
          {num("crmFitContribution", "Fit")}
          {num("crmPainContribution", "Pain")}
          {num("crmMaturityContribution", "Maturity")}
          {num("crmIntentContribution", "Intent")}
          {num("crmUrgencyContribution", "Urgency")}
        </div>
      </div>
    </div>
  );
}

// ─── RuleRow ──────────────────────────────────────────────────────────────────

function RuleRow({
  rule, conflicts, editingRuleId, editRuleForm, setEditRuleForm, setEditingRuleId,
  deletingRuleId, savingRule, onEdit, onSave, onDelete, conflictError,
}: {
  rule: SignalRule;
  conflicts: Conflict[];
  editingRuleId: number | null;
  editRuleForm: { ruleType: string; sourceKey: string; compareValue: string; description: string; intel: IntelFormFields };
  setEditRuleForm: React.Dispatch<React.SetStateAction<typeof editRuleForm>>;
  setEditingRuleId: (id: number | null) => void;
  deletingRuleId: number | null;
  savingRule: boolean;
  onEdit: (r: SignalRule) => void;
  onSave: () => void;
  onDelete: () => void;
  conflictError: string | null;
}) {
  const isEditing = editingRuleId === rule.id;
  const conflictText = conflicts.find(c => c.ruleIds.includes(rule.id))?.description;
  const isConflict = !!conflictText;

  if (isEditing) {
    return (
      <div className="px-4 py-3 bg-accent space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select value={editRuleForm.ruleType} onChange={e => setEditRuleForm(f => ({ ...f, ruleType: e.target.value }))}
            className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs">
            {RULE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input value={editRuleForm.sourceKey} onChange={e => setEditRuleForm(f => ({ ...f, sourceKey: e.target.value }))}
            className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs font-mono"
            placeholder="Source key" />
        </div>
        {needsCompare(editRuleForm.ruleType) && (
          <input value={editRuleForm.compareValue} onChange={e => setEditRuleForm(f => ({ ...f, compareValue: e.target.value }))}
            className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs font-mono w-32"
            placeholder="Value" />
        )}
        <input value={editRuleForm.description} onChange={e => setEditRuleForm(f => ({ ...f, description: e.target.value }))}
          className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs w-full"
          placeholder="Description" />
        <div className="rounded border border-border bg-background/40 p-2">
          <IntelligenceFieldsPanel value={editRuleForm.intel} onChange={intel => setEditRuleForm(f => ({ ...f, intel }))} />
        </div>
        {conflictError && (
          <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">{conflictError}</p>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onSave} disabled={savingRule}
            className="px-3 py-1 bg-primary text-white text-xs rounded hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1">
            {savingRule ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
          </button>
          <button onClick={() => setEditingRuleId(null)} className="px-3 py-1 bg-card text-muted-foreground text-xs rounded hover:text-foreground">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 group">
      <RuleTypePill ruleType={rule.ruleType} />
      <code className="text-xs text-foreground/90 font-mono flex-1 truncate">{rule.sourceKey}</code>
      {rule.compareValue && <code className="text-xs text-muted-foreground font-mono">{rule.compareValue}</code>}
      {rule.description && <p className="text-xs text-muted-foreground/60 truncate max-w-32">{rule.description}</p>}
      {rule.category && (
        <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
          {rule.category}
        </span>
      )}
      {isConflict && <span title={conflictText}><AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" /></span>}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
        <button onClick={() => onEdit(rule)} className="p-1 text-muted-foreground hover:text-primary transition-colors">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} disabled={deletingRuleId === rule.id}
          className="p-1 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50">
          {deletingRuleId === rule.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface EngineRuleEditorProps {
  engineKey: string;
  categoryPrefix: string;
  engineLabel: string;
  importRevision?: number;
}

export default function EngineRuleEditor({ engineKey, categoryPrefix, engineLabel, importRevision }: EngineRuleEditorProps) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [rules, setRules] = useState<SignalRule[]>([]);
  const [groups, setGroups] = useState<SignalGroup[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);
  const [newSignalKey, setNewSignalKey] = useState(`${categoryPrefix}:`);
  const [showNewSignalInput, setShowNewSignalInput] = useState(false);

  // Group editing
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editGroupForm, setEditGroupForm] = useState({ label: "", logic: "OR" as "AND" | "OR", intel: EMPTY_INTEL });
  const [savingGroupEdit, setSavingGroupEdit] = useState(false);

  // Add group
  const [addGroupForm, setAddGroupForm] = useState({ logic: "OR" as "AND" | "OR", label: "", intel: EMPTY_INTEL });
  const [showAddGroupIntel, setShowAddGroupIntel] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);

  // Rule editing
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editRuleForm, setEditRuleForm] = useState({ ruleType: "profile_key_truthy", sourceKey: "", compareValue: "", description: "", intel: EMPTY_INTEL });
  const [editRuleConflictError, setEditRuleConflictError] = useState<string | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<number | null>(null);
  const [savingRule, setSavingRule] = useState(false);

  // Add rule
  const [addRuleForm, setAddRuleForm] = useState({ ruleType: "profile_key_truthy", sourceKey: "", compareValue: "", description: "", groupId: "", intel: EMPTY_INTEL });
  const [addRuleConflictError, setAddRuleConflictError] = useState<string | null>(null);
  const [showAddRuleIntel, setShowAddRuleIntel] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, conflictsRes] = await Promise.all([
        fetchWithAuth(`/api/admin/engines/${engineKey}/configuration`),
        fetchWithAuth("/api/admin/signal-rules/conflicts"),
      ]);
      if (configRes.ok) {
        const data = await configRes.json() as { rules: SignalRule[]; groups: SignalGroup[] };
        setRules(data.rules ?? []);
        setGroups(data.groups ?? []);
      }
      if (conflictsRes.ok) {
        const d = await conflictsRes.json() as { conflicts: Conflict[] };
        setConflicts(d.conflicts ?? []);
      }
    } catch {
      toast({ title: "Failed to load engine rules", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [engineKey, fetchWithAuth, toast]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => { if (importRevision) void loadData(); }, [importRevision, loadData]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const signalKeys = useMemo(() => {
    const keys = new Set([...groups.map(g => g.signalKey), ...rules.map(r => r.signalKey)]);
    return [...keys].sort();
  }, [groups, rules]);

  const selectedGroups = useMemo(() => groups.filter(g => g.signalKey === selectedSignal), [groups, selectedSignal]);
  const selectedRules = useMemo(() => rules.filter(r => r.signalKey === selectedSignal), [rules, selectedSignal]);
  const conflictRuleIds = useMemo(() => new Set(conflicts.flatMap(c => c.ruleIds)), [conflicts]);

  // Auto-select first signal when data loads
  useEffect(() => {
    if (!selectedSignal && signalKeys.length > 0) setSelectedSignal(signalKeys[0]);
  }, [signalKeys, selectedSignal]);

  // ── Group CRUD ───────────────────────────────────────────────────────────────

  async function handleAddGroup() {
    if (!selectedSignal) return;
    setSavingGroup(true);
    try {
      const defaultCategory = `${categoryPrefix}:general`;
      const intel = { ...intelToBody(addGroupForm.intel) };
      if (!intel.category) intel.category = defaultCategory;
      const res = await fetchWithAuth("/api/admin/signal-rule-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signalKey: selectedSignal, logic: addGroupForm.logic, label: addGroupForm.label.trim() || null, ...intel }),
      });
      if (res.ok) {
        toast({ title: "Group added" });
        setAddGroupForm({ logic: "OR", label: "", intel: EMPTY_INTEL });
        setShowAddGroupIntel(false);
        await loadData();
      } else {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Failed to add group", variant: "destructive" });
      }
    } finally { setSavingGroup(false); }
  }

  async function handleSaveEditGroup(id: number) {
    setSavingGroupEdit(true);
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rule-groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: editGroupForm.label.trim() || null, logic: editGroupForm.logic, ...intelToBody(editGroupForm.intel) }),
      });
      if (res.ok) {
        toast({ title: "Group updated" });
        setEditingGroupId(null);
        await loadData();
      } else {
        toast({ title: "Failed to update group", variant: "destructive" });
      }
    } finally { setSavingGroupEdit(false); }
  }

  async function handleDeleteGroup(id: number) {
    if (!confirm("Delete this group and all its rules?")) return;
    const res = await fetchWithAuth(`/api/admin/signal-rule-groups/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "Group deleted" }); await loadData(); }
    else toast({ title: "Failed to delete group", variant: "destructive" });
  }

  async function handleToggleGroupLogic(group: SignalGroup) {
    const newLogic = group.logic === "AND" ? "OR" : "AND";
    const res = await fetchWithAuth(`/api/admin/signal-rule-groups/${group.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logic: newLogic }),
    });
    if (res.ok) await loadData();
    else toast({ title: "Failed to update group", variant: "destructive" });
  }

  // ── Rule CRUD ────────────────────────────────────────────────────────────────

  async function handleAddRule() {
    if (!selectedSignal || !addRuleForm.sourceKey.trim()) {
      toast({ title: "Source key is required", variant: "destructive" }); return;
    }
    setAddRuleConflictError(null);
    setSavingRule(true);
    try {
      const defaultCategory = `${categoryPrefix}:general`;
      const intel = { ...intelToBody(addRuleForm.intel) };
      if (!intel.category) intel.category = defaultCategory;
      const res = await fetchWithAuth("/api/admin/signal-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signalKey: selectedSignal,
          ruleType: addRuleForm.ruleType,
          sourceKey: addRuleForm.sourceKey.trim(),
          compareValue: needsCompare(addRuleForm.ruleType) ? addRuleForm.compareValue.trim() || null : null,
          description: addRuleForm.description.trim() || null,
          groupId: addRuleForm.groupId ? Number(addRuleForm.groupId) : null,
          ...intel,
        }),
      });
      if (res.ok) {
        toast({ title: "Rule added" });
        setAddRuleForm({ ruleType: "profile_key_truthy", sourceKey: "", compareValue: "", description: "", groupId: "", intel: EMPTY_INTEL });
        setShowAddRuleIntel(false);
        await loadData();
      } else if (res.status === 422) {
        const body = await res.json() as { error: string; conflicts: Conflict[] };
        setAddRuleConflictError((body.conflicts ?? []).map(c => c.description).join(" | ") || body.error);
      } else {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Failed to add rule", variant: "destructive" });
      }
    } finally { setSavingRule(false); }
  }

  async function handleSaveEditRule(id: number) {
    setEditRuleConflictError(null);
    setSavingRule(true);
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleType: editRuleForm.ruleType,
          sourceKey: editRuleForm.sourceKey.trim(),
          compareValue: needsCompare(editRuleForm.ruleType) ? editRuleForm.compareValue.trim() || null : null,
          description: editRuleForm.description.trim() || null,
          ...intelToBody(editRuleForm.intel),
        }),
      });
      if (res.ok) {
        toast({ title: "Rule updated" });
        setEditingRuleId(null);
        await loadData();
      } else if (res.status === 422) {
        const body = await res.json() as { error: string; conflicts: Conflict[] };
        setEditRuleConflictError((body.conflicts ?? []).map(c => c.description).join(" | ") || body.error);
      } else {
        toast({ title: "Failed to update rule", variant: "destructive" });
      }
    } finally { setSavingRule(false); }
  }

  async function handleDeleteRule(id: number) {
    setDeletingRuleId(id);
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rules/${id}`, { method: "DELETE" });
      if (res.ok) { toast({ title: "Rule deleted" }); await loadData(); }
      else toast({ title: "Failed to delete rule", variant: "destructive" });
    } finally { setDeletingRuleId(null); }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="w-4 h-4 animate-spin" />Loading engine rules…
      </div>
    );
  }

  const inputCls = "w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40";

  return (
    <div className="flex gap-0 min-h-[28rem] border border-border rounded-xl overflow-hidden">
      {/* ── Left: signal key list ────────────────────────────────────────────── */}
      <div className="w-52 flex-shrink-0 border-r border-border bg-background flex flex-col">
        <div className="px-3 py-2 border-b border-border">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-semibold">
            {engineLabel} Signals
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {signalKeys.length === 0 && !showNewSignalInput && (
            <p className="px-3 py-4 text-xs text-muted-foreground/60 italic">No signals yet — add one below.</p>
          )}
          {signalKeys.map(key => {
            const shortKey = key.startsWith(`${categoryPrefix}:`) ? key.slice(categoryPrefix.length + 1) : key;
            const ruleCount = rules.filter(r => r.signalKey === key).length;
            const groupCount = groups.filter(g => g.signalKey === key).length;
            return (
              <button
                key={key}
                onClick={() => setSelectedSignal(key)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors ${
                  selectedSignal === key
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground/90"
                }`}
              >
                <p className="text-xs font-mono truncate leading-tight">{shortKey}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  {groupCount}g · {ruleCount}r
                </p>
              </button>
            );
          })}
        </div>
        {/* Add new signal key */}
        <div className="border-t border-border p-2">
          {showNewSignalInput ? (
            <div className="space-y-1.5">
              <input
                value={newSignalKey}
                onChange={e => setNewSignalKey(e.target.value)}
                placeholder={`${categoryPrefix}:my-signal`}
                className="w-full border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/40"
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const key = newSignalKey.trim();
                    if (key) setSelectedSignal(key);
                    setShowNewSignalInput(false);
                  } else if (e.key === "Escape") {
                    setShowNewSignalInput(false);
                  }
                }}
              />
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    const key = newSignalKey.trim();
                    if (key) { setSelectedSignal(key); }
                    setShowNewSignalInput(false);
                  }}
                  className="flex-1 text-xs bg-primary text-white rounded px-2 py-1 hover:bg-primary/90"
                >
                  Use
                </button>
                <button
                  onClick={() => { setShowNewSignalInput(false); setNewSignalKey(`${categoryPrefix}:`); }}
                  className="flex-1 text-xs bg-accent text-muted-foreground rounded px-2 py-1 hover:text-foreground/90"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setNewSignalKey(`${categoryPrefix}:`); setShowNewSignalInput(true); }}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-primary py-1 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New signal key
            </button>
          )}
        </div>
      </div>

      {/* ── Right: rules/groups editor ───────────────────────────────────────── */}
      <div className="flex-1 bg-background overflow-y-auto">
        {!selectedSignal ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground/60 italic">
            Select a signal key on the left to edit its rules
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Signal key header */}
            <div className="flex items-center gap-2">
              <code className="text-sm font-semibold text-primary font-mono">{selectedSignal}</code>
              <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full">
                {selectedGroups.length} group{selectedGroups.length !== 1 ? "s" : ""} · {selectedRules.length} rule{selectedRules.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Groups with their rules */}
            {selectedGroups.map(group => {
              const groupRules = selectedRules.filter(r => r.groupId === group.id);
              return (
                <div key={group.id} className="border border-border rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-accent border-b border-border">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleToggleGroupLogic(group)}
                        title="Click to toggle AND/OR"
                        className={`text-xs font-bold px-2 py-0.5 rounded border ${
                          group.logic === "AND"
                            ? "bg-blue-900/30 text-blue-400 border-blue-500/30"
                            : "bg-green-900/30 text-green-400 border-green-500/30"
                        }`}
                      >
                        {group.logic}
                      </button>
                      <span className="text-sm font-semibold text-foreground/90">{group.label ?? `Group ${group.id}`}</span>
                      {group.category && (
                        <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full">
                          {group.category}
                        </span>
                      )}
                      {group.severity && (
                        <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                          {group.severity}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (editingGroupId === group.id) { setEditingGroupId(null); return; }
                          setEditingGroupId(group.id);
                          setEditGroupForm({ label: group.label ?? "", logic: group.logic, intel: intelFromRow(group) });
                        }}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="Edit group"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => void handleDeleteGroup(group.id)}
                        className="text-muted-foreground/60 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {editingGroupId === group.id && (
                    <div className="px-4 py-3 bg-card border-b border-border space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5">Label</label>
                          <input value={editGroupForm.label}
                            onChange={e => setEditGroupForm(f => ({ ...f, label: e.target.value }))}
                            placeholder="Label (optional)" className={inputCls} />
                        </div>
                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5">Logic</label>
                          <select value={editGroupForm.logic}
                            onChange={e => setEditGroupForm(f => ({ ...f, logic: e.target.value as "AND" | "OR" }))}
                            className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm">
                            <option value="OR">OR</option>
                            <option value="AND">AND</option>
                          </select>
                        </div>
                      </div>
                      <div className="rounded border border-border bg-background/40 p-2">
                        <IntelligenceFieldsPanel value={editGroupForm.intel} onChange={intel => setEditGroupForm(f => ({ ...f, intel }))} />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => void handleSaveEditGroup(group.id)} disabled={savingGroupEdit}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50">
                          {savingGroupEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                        </button>
                        <button onClick={() => setEditingGroupId(null)}
                          className="px-3 py-1.5 bg-accent text-foreground/90 text-xs rounded-lg hover:bg-border">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="divide-y divide-border/50">
                    {groupRules.map(rule => (
                      <RuleRow key={rule.id} rule={rule} conflicts={conflicts}
                        editingRuleId={editingRuleId} editRuleForm={editRuleForm}
                        setEditRuleForm={setEditRuleForm} setEditingRuleId={setEditingRuleId}
                        deletingRuleId={deletingRuleId} savingRule={savingRule}
                        conflictError={editingRuleId === rule.id ? editRuleConflictError : null}
                        onEdit={r => { setEditRuleConflictError(null); setEditingRuleId(r.id); setEditRuleForm({ ruleType: r.ruleType, sourceKey: r.sourceKey, compareValue: r.compareValue ?? "", description: r.description ?? "", intel: intelFromRow(r) }); }}
                        onSave={() => void handleSaveEditRule(rule.id)}
                        onDelete={() => void handleDeleteRule(rule.id)}
                      />
                    ))}
                    {groupRules.length === 0 && (
                      <p className="px-4 py-3 text-xs text-muted-foreground/60 italic">
                        No rules in this group yet — add rules below and assign them to this group.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Ungrouped rules */}
            {selectedRules.filter(r => r.groupId == null).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Ungrouped Rules
                </p>
                <div className="border border-border rounded-xl divide-y divide-border/50 overflow-hidden">
                  {selectedRules.filter(r => r.groupId == null).map(rule => (
                    <RuleRow key={rule.id} rule={rule} conflicts={conflicts}
                      editingRuleId={editingRuleId} editRuleForm={editRuleForm}
                      setEditRuleForm={setEditRuleForm} setEditingRuleId={setEditingRuleId}
                      deletingRuleId={deletingRuleId} savingRule={savingRule}
                      conflictError={editingRuleId === rule.id ? editRuleConflictError : null}
                      onEdit={r => { setEditRuleConflictError(null); setEditingRuleId(r.id); setEditRuleForm({ ruleType: r.ruleType, sourceKey: r.sourceKey, compareValue: r.compareValue ?? "", description: r.description ?? "", intel: intelFromRow(r) }); }}
                      onSave={() => void handleSaveEditRule(rule.id)}
                      onDelete={() => void handleDeleteRule(rule.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {selectedRules.length === 0 && selectedGroups.length === 0 && (
              <p className="text-sm text-muted-foreground italic py-2">
                No rules or groups for this signal yet. Use the forms below to add some.
              </p>
            )}

            {/* ── Add Rule form ──────────────────────────────────────────────── */}
            <div className="border border-dashed border-border rounded-xl p-4 space-y-3 bg-background">
              <p className="text-xs font-bold text-foreground/90 uppercase tracking-wide">Add Rule</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Rule Type</label>
                  <select value={addRuleForm.ruleType} onChange={e => setAddRuleForm(f => ({ ...f, ruleType: e.target.value }))}
                    className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                    {RULE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    {addRuleForm.ruleType === "findings_keyword" ? "Keyword" : "Profile Key"}
                  </label>
                  <input value={addRuleForm.sourceKey} onChange={e => setAddRuleForm(f => ({ ...f, sourceKey: e.target.value }))}
                    placeholder="e.g. mfaEnforced" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {needsCompare(addRuleForm.ruleType) && (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Compare Value</label>
                    <input value={addRuleForm.compareValue} onChange={e => setAddRuleForm(f => ({ ...f, compareValue: e.target.value }))}
                      placeholder="e.g. 60" className={inputCls} />
                  </div>
                )}
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Group (optional)</label>
                  <select value={addRuleForm.groupId} onChange={e => setAddRuleForm(f => ({ ...f, groupId: e.target.value }))}
                    className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                    <option value="">— Ungrouped —</option>
                    {selectedGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.label ?? `Group ${g.id}`} ({g.logic})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Description (optional)</label>
                <input value={addRuleForm.description} onChange={e => setAddRuleForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Why does this rule matter?" className={inputCls} />
              </div>
              <button onClick={() => setShowAddRuleIntel(v => !v)}
                className="text-xs text-muted-foreground hover:text-foreground/90 transition-colors">
                {showAddRuleIntel ? "▲ Hide intelligence fields" : "▼ Show intelligence fields"}
              </button>
              {showAddRuleIntel && (
                <div className="rounded border border-border bg-background/40 p-3">
                  <IntelligenceFieldsPanel value={addRuleForm.intel} onChange={intel => setAddRuleForm(f => ({ ...f, intel }))} />
                </div>
              )}
              {addRuleConflictError && (
                <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">{addRuleConflictError}</p>
                </div>
              )}
              <div className="flex items-center gap-3 pt-1">
                <button onClick={() => void handleAddRule()} disabled={savingRule || !addRuleForm.sourceKey.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {savingRule ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add Rule
                </button>

                {/* Add Group inline */}
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-muted-foreground">Add Group:</span>
                  <select value={addGroupForm.logic} onChange={e => setAddGroupForm(f => ({ ...f, logic: e.target.value as "AND" | "OR" }))}
                    className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs focus:outline-none">
                    <option value="OR">OR</option>
                    <option value="AND">AND</option>
                  </select>
                  <input value={addGroupForm.label} onChange={e => setAddGroupForm(f => ({ ...f, label: e.target.value }))}
                    placeholder="Label (optional)"
                    className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs focus:outline-none w-36" />
                  <button onClick={() => setShowAddGroupIntel(v => !v)}
                    className="px-2 py-1 bg-accent text-muted-foreground text-xs rounded hover:bg-border transition-colors">
                    {showAddGroupIntel ? "Hide" : "More"}
                  </button>
                  <button onClick={() => void handleAddGroup()} disabled={savingGroup}
                    className="px-2 py-1 bg-accent text-foreground/90 text-xs rounded hover:bg-border transition-colors disabled:opacity-50">
                    {savingGroup ? <Loader2 className="w-3 h-3 animate-spin" /> : "+"}
                  </button>
                </div>
              </div>
              {showAddGroupIntel && (
                <div className="rounded border border-border bg-background/40 p-3 mt-1">
                  <IntelligenceFieldsPanel value={addGroupForm.intel} onChange={intel => setAddGroupForm(f => ({ ...f, intel }))} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
