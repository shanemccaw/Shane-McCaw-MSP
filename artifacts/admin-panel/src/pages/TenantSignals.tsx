import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, Check, Circle, Plus, Trash2, Pencil, X, ChevronRight, Download,
  Upload, Save, RotateCcw, Loader2, Play, Eye, Zap, Search, Tag, Clock, FlaskConical, Database,
  TrendingUp, TrendingDown, Package,
} from "lucide-react";

interface TenantSignal {
  key: string;
  label: string;
  description: string;
  expectedImpact: string;
  recommendedRules: Array<{ ruleType: string; sourceKey: string; compareValue?: string; rationale: string }>;
  unlocksProjects?: Array<{ id: number; title: string }>;
  enabled?: boolean;
}

// Intelligence fields shared by signal rules and rule groups — pure data, not
// consumed by any evaluation logic yet (see lib/tenant-signals.ts taxonomy doc).
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

const SIGNAL_CATEGORY_PREFIXES = [
  "pricing", "priority", "governance", "security", "compliance", "adoption",
  "copilot", "architecture", "drift", "forecasting", "crm", "msp", "workflow",
] as const;

// All intelligence fields as string-valued form state (numbers kept as text so
// inputs can be blank / partially typed without fighting NaN coercion).
interface IntelFormFields {
  category: string;
  priority: string;
  weight: string;
  pricingImpact: string;
  priorityScoreContribution: string;
  pricingValueContribution: string;
  governanceImpact: string;
  securityImpact: string;
  complianceImpact: string;
  adoptionImpact: string;
  copilotImpact: string;
  architectureImpact: string;
  trendValue: string;
  trendDirection: string;
  decayRate: string;
  ttlDays: string;
  confidence: string;
  severity: string;
  pillar: string;
  crmFitContribution: string;
  crmPainContribution: string;
  crmMaturityContribution: string;
  crmIntentContribution: string;
  crmUrgencyContribution: string;
}

const EMPTY_INTEL_FORM: IntelFormFields = {
  category: "", priority: "", weight: "", pricingImpact: "", priorityScoreContribution: "",
  pricingValueContribution: "", governanceImpact: "", securityImpact: "", complianceImpact: "",
  adoptionImpact: "", copilotImpact: "", architectureImpact: "", trendValue: "", trendDirection: "",
  decayRate: "", ttlDays: "", confidence: "", severity: "", pillar: "", crmFitContribution: "",
  crmPainContribution: "", crmMaturityContribution: "", crmIntentContribution: "", crmUrgencyContribution: "",
};

function intelFormFromRow(row: Partial<SignalIntelligenceFields>): IntelFormFields {
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
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

/** Builds the JSON body fragment for the intelligence fields — omits blank inputs so PATCH merges against the prior row. */
function intelFormToBody(f: IntelFormFields): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const setNum = (key: keyof IntelFormFields) => { if (f[key].trim() !== "") body[key] = Number(f[key]); };
  const setStr = (key: keyof IntelFormFields) => { if (f[key].trim() !== "") body[key] = f[key].trim(); };
  setStr("category"); setNum("priority"); setNum("weight");
  setNum("pricingImpact"); setNum("priorityScoreContribution"); setNum("pricingValueContribution");
  setNum("governanceImpact"); setNum("securityImpact"); setNum("complianceImpact");
  setNum("adoptionImpact"); setNum("copilotImpact"); setNum("architectureImpact");
  setNum("trendValue"); setStr("trendDirection"); setNum("decayRate"); setNum("ttlDays"); setNum("confidence");
  setStr("severity"); setStr("pillar");
  setNum("crmFitContribution"); setNum("crmPainContribution"); setNum("crmMaturityContribution");
  setNum("crmIntentContribution"); setNum("crmUrgencyContribution");
  return body;
}

function IntelligenceFieldsPanel({ value, onChange, compact }: { value: IntelFormFields; onChange: (f: IntelFormFields) => void; compact?: boolean }) {
  const set = <K extends keyof IntelFormFields>(key: K, v: string) => onChange({ ...value, [key]: v });
  const inputCls = compact
    ? "border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs font-mono w-full"
    : "w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40";
  const selectCls = compact
    ? "border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs w-full"
    : "w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";
  const labelCls = compact ? "block text-[10px] text-muted-foreground mb-0.5" : "block text-xs text-muted-foreground mb-1";
  const numField = (
    key: keyof IntelFormFields,
    label: string,
    placeholder = "0",
    extra?: { step?: string; min?: string; max?: string },
  ) => (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type="number"
        step={extra?.step}
        min={extra?.min}
        max={extra?.max}
        value={value[key]}
        onChange={e => set(key, e.target.value)}
        placeholder={placeholder}
        className={inputCls}
      />
    </div>
  );
  const gridCls = compact ? "grid grid-cols-3 gap-2" : "grid grid-cols-3 gap-3";
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1.5">Core</p>
        <div className={gridCls}>
          <div>
            <label className={labelCls}>Category</label>
            <select value={value.category} onChange={e => set("category", e.target.value)} className={selectCls}>
              <option value="">— None —</option>
              {SIGNAL_CATEGORY_PREFIXES.map(prefix => (
                <option key={prefix} value={`${prefix}:general`}>{prefix}:*</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Pillar</label>
            <input value={value.pillar} onChange={e => set("pillar", e.target.value)} placeholder="e.g. licensing" className={compact ? "border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs w-full" : "w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"} />
          </div>
          <div>
            <label className={labelCls}>Severity</label>
            <select value={value.severity} onChange={e => set("severity", e.target.value)} className={selectCls}>
              <option value="">— low —</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
          </div>
          {numField("priority", "Priority")}
          {numField("weight", "Weight")}
          {numField("confidence", "Confidence")}
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1.5">Impact & contribution</p>
        <div className={gridCls}>
          {numField("pricingImpact", "Pricing impact")}
          {numField("priorityScoreContribution", "Priority score contrib.")}
          {numField("pricingValueContribution", "Pricing value contrib.")}
          {numField("governanceImpact", "Governance impact")}
          {numField("securityImpact", "Security impact")}
          {numField("complianceImpact", "Compliance impact")}
          {numField("adoptionImpact", "Adoption impact")}
          {numField("copilotImpact", "Copilot impact")}
          {numField("architectureImpact", "Architecture impact")}
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1.5">Trend & forecasting</p>
        <div className={gridCls}>
          {numField("trendValue", "Trend value")}
          <div>
            <label className={labelCls}>Trend direction</label>
            <select value={value.trendDirection} onChange={e => set("trendDirection", e.target.value)} className={selectCls}>
              <option value="">— flat —</option>
              <option value="up">up</option>
              <option value="down">down</option>
              <option value="flat">flat</option>
            </select>
          </div>
          {numField("decayRate", "Decay rate (0–1)", "0", { step: "0.01", min: "0", max: "1" })}
          {numField("ttlDays", "TTL (days)")}
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1.5">CRM contribution</p>
        <div className={gridCls}>
          {numField("crmFitContribution", "Fit")}
          {numField("crmPainContribution", "Pain")}
          {numField("crmMaturityContribution", "Maturity")}
          {numField("crmIntentContribution", "Intent")}
          {numField("crmUrgencyContribution", "Urgency")}
        </div>
      </div>
    </div>
  );
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
  updatedAt?: string | null;
}

interface SignalGroup extends Partial<SignalIntelligenceFields> {
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
  lastRunProjectDiff: {
    includedProjects: Array<{ id: number; title: string; priceRange: string | null }>;
    excludedProjects: Array<{ project: { id: number; title: string }; reason: string }>;
  } | null;
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

interface EngagementProject {
  id: number;
  title: string;
  priceRange: string;
  description: string | null;
  meaning: string | null;
  triggeredBy: string[];
  sowItems: unknown[];
  pages: unknown[];
  sortOrder: number;
  isVisible: boolean;
}

interface ClientWithRuns {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
  runCount: number;
  lastRunAt: string;
}

interface SimProfileRunDiff {
  newlyIncluded: Array<{ id: number; title: string }>;
  movedToExcluded: Array<{ id: number; title: string }>;
  newlyFired: Array<{ key: string; label: string }>;
  stoppedFiring: Array<{ key: string; label: string }>;
}

interface SimProfileRunResult {
  firedSignals: Array<{ key: string; label: string; expectedImpact: string }>;
  ruleTrace: RuleTraceEntry[];
  includedProjects: Array<{ id: number; title: string; priceRange: string | null }>;
  excludedProjects: Array<{ project: { id: number; title: string }; reason: string }>;
  previousRunDiff: SimProfileRunDiff | null;
}

function timeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
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
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${opt?.color ?? "bg-border text-muted-foreground"}`}>
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
  const [adjustmentSignals, setAdjustmentSignals] = useState<TenantSignal[]>([]);
  const [customSignalKeys, setCustomSignalKeys] = useState<Set<string>>(new Set());
  const [deletingSignalKey, setDeletingSignalKey] = useState<string | null>(null);
  const [signalSection, setSignalSection] = useState<"project" | "adjustment">("project");
  const [rules, setRules] = useState<SignalRule[]>([]);
  const [groups, setGroups] = useState<SignalGroup[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [health, setHealth] = useState<HealthData>({});
  const [versions, setVersions] = useState<Version[]>([]);
  const [scriptFields, setScriptFields] = useState<ScriptField[]>([]);
  const [simProfiles, setSimProfiles] = useState<SimulationProfile[]>([]);

  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"rules" | "projects" | "docs" | "audit">("rules");
  const [allEngagementProjects, setAllEngagementProjects] = useState<EngagementProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const [showTestModal, setShowTestModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showDryRunModal, setShowDryRunModal] = useState(false);
  const [showConflictsPanel, setShowConflictsPanel] = useState(false);
  const [showSnapshotsPanel, setShowSnapshotsPanel] = useState(false);
  const [showScriptExplorer, setShowScriptExplorer] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSignalImportModal, setShowSignalImportModal] = useState(false);
  const [signalImportJson, setSignalImportJson] = useState("");
  const [signalImportRunning, setSignalImportRunning] = useState(false);

  const [showNewSignalModal, setShowNewSignalModal] = useState(false);
  const [newSignalForm, setNewSignalForm] = useState({ label: "", key: "", description: "", expectedImpact: "", isAdjustment: false });
  const [savingNewSignal, setSavingNewSignal] = useState(false);
  const [newSignalError, setNewSignalError] = useState<string | null>(null);

  const [showBundleModal, setShowBundleModal] = useState(false);
  const [bundleJson, setBundleJson] = useState("");
  const [bundleRunning, setBundleRunning] = useState(false);
  const bundleFileRef = useRef<HTMLInputElement>(null);

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

  const [addRuleForm, setAddRuleForm] = useState({ ruleType: "profile_key_truthy", sourceKey: "", compareValue: "", description: "", groupId: "", intel: EMPTY_INTEL_FORM });
  const [addRuleConflictError, setAddRuleConflictError] = useState<string | null>(null);
  const [savingRule, setSavingRule] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editRuleForm, setEditRuleForm] = useState({ ruleType: "", sourceKey: "", compareValue: "", description: "", intel: EMPTY_INTEL_FORM });
  const [editRuleConflictError, setEditRuleConflictError] = useState<string | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<number | null>(null);

  const [addGroupForm, setAddGroupForm] = useState({ logic: "OR" as "AND" | "OR", label: "", intel: EMPTY_INTEL_FORM });
  const [savingGroup, setSavingGroup] = useState(false);
  const [showAddGroupIntel, setShowAddGroupIntel] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editGroupForm, setEditGroupForm] = useState({ label: "", intel: EMPTY_INTEL_FORM });
  const [savingGroupEdit, setSavingGroupEdit] = useState(false);

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
  const [expandedProfileIds, setExpandedProfileIds] = useState<Set<number>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const signalFileInputRef = useRef<HTMLInputElement>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [signalsRes, adjSignalsRes, rulesRes, conflictsRes, healthRes, versionsRes, customRes] = await Promise.all([
        fetchWithAuth("/api/admin/engagement-projects/signals"),
        fetchWithAuth("/api/admin/signal-rules/adjustment-signals"),
        fetchWithAuth("/api/admin/signal-rules"),
        fetchWithAuth("/api/admin/signal-rules/conflicts"),
        fetchWithAuth("/api/admin/signal-rules/health"),
        fetchWithAuth("/api/admin/signal-rules/versions"),
        fetchWithAuth("/api/admin/custom-signals"),
      ]);

      if (signalsRes.ok) setSignals(await signalsRes.json() as TenantSignal[]);
      if (adjSignalsRes.ok) setAdjustmentSignals(await adjSignalsRes.json() as TenantSignal[]);
      if (customRes.ok) {
        const custom = await customRes.json() as Array<{ key: string }>;
        setCustomSignalKeys(new Set(custom.map(c => c.key)));
      }
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
    if (res.ok) {
      const profiles = await res.json() as SimulationProfile[];
      setSimProfiles(profiles);
      setProfileRunResults(prev => {
        const seeded: Record<number, SimProfileRunResult> = { ...prev };
        for (const p of profiles) {
          if (p.lastRunResult && p.lastRunProjectDiff && !(p.id in seeded)) {
            seeded[p.id] = {
              firedSignals: p.lastRunResult as Array<{ key: string; label: string; expectedImpact: string }>,
              ruleTrace: [],
              includedProjects: p.lastRunProjectDiff.includedProjects,
              excludedProjects: p.lastRunProjectDiff.excludedProjects,
              previousRunDiff: null,
            };
          }
        }
        return seeded;
      });
      setExpandedProfileIds(prev => {
        const ids = new Set(prev);
        for (const p of profiles) {
          if (p.lastRunResult && p.lastRunProjectDiff) ids.add(p.id);
        }
        return ids;
      });
    }
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

  const loadEngagementProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/engagement-projects");
      if (res.ok) setAllEngagementProjects(await res.json() as EngagementProject[]);
    } finally {
      setProjectsLoading(false);
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

  useEffect(() => {
    if (activeTab === "projects") void loadEngagementProjects();
  }, [activeTab, loadEngagementProjects]);

  const signalRules = (key: string) => rules.filter(r => r.signalKey === key);
  const signalGroups = (key: string) => groups.filter(g => g.signalKey === key);
  const conflictRuleIds = new Set(conflicts.flatMap(c => c.ruleIds));
  const signalConflictCount = (key: string) => conflicts.filter(c =>
    c.ruleIds.some(id => rules.find(r => r.id === id && r.signalKey === key))
  ).length;

  const selectedSignalData = signals.find(s => s.key === selectedSignal)
    ?? adjustmentSignals.find(s => s.key === selectedSignal);
  const selectedRules = selectedSignal ? signalRules(selectedSignal) : [];
  const selectedGroups = selectedSignal ? signalGroups(selectedSignal) : [];

  const associatedProjects = allEngagementProjects.filter(p =>
    Array.isArray(p.triggeredBy) && p.triggeredBy.includes(selectedSignal ?? "")
  );
  const availableProjects = allEngagementProjects.filter(p =>
    !Array.isArray(p.triggeredBy) || !p.triggeredBy.includes(selectedSignal ?? "")
  );

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
    setAddRuleConflictError(null);
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
          ...intelFormToBody(addRuleForm.intel),
        }),
      });
      if (res.ok) {
        toast({ title: "Rule added" });
        setAddRuleForm({ ruleType: "profile_key_truthy", sourceKey: "", compareValue: "", description: "", groupId: "", intel: EMPTY_INTEL_FORM });
        await loadAll();
      } else if (res.status === 422) {
        const body = await res.json() as { error: string; conflicts: Array<{ ruleIds: number[]; description: string }> };
        const descriptions = (body.conflicts ?? []).map(c => c.description).join(" | ");
        setAddRuleConflictError(descriptions || body.error);
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
    setEditRuleConflictError(null);
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
          ...intelFormToBody(editRuleForm.intel),
        }),
      });
      if (res.ok) {
        toast({ title: "Rule updated" });
        setEditingRuleId(null);
        setEditRuleConflictError(null);
        await loadAll();
      } else if (res.status === 422) {
        const body = await res.json() as { error: string; conflicts: Array<{ ruleIds: number[]; description: string }> };
        const descriptions = (body.conflicts ?? []).map(c => c.description).join(" | ");
        setEditRuleConflictError(descriptions || body.error);
      } else {
        toast({ title: "Failed to update rule", variant: "destructive" });
      }
    } finally { setSavingRule(false); }
  }

  async function handleCreateSignal() {
    if (!newSignalForm.label.trim()) return;
    setSavingNewSignal(true);
    setNewSignalError(null);
    try {
      const res = await fetchWithAuth("/api/admin/custom-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: newSignalForm.key.trim() || newSignalForm.label.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-"),
          label: newSignalForm.label.trim(),
          description: newSignalForm.description.trim(),
          expectedImpact: newSignalForm.expectedImpact.trim(),
          isAdjustment: newSignalForm.isAdjustment,
        }),
      });
      const body = await res.json() as { key?: string; error?: string };
      if (res.ok && body.key) {
        toast({ title: "Signal created" });
        setShowNewSignalModal(false);
        setNewSignalForm({ label: "", key: "", description: "", expectedImpact: "", isAdjustment: false });
        await loadAll();
        setSignalSection(newSignalForm.isAdjustment ? "adjustment" : "project");
        setSelectedSignal(body.key);
      } else {
        setNewSignalError(body.error ?? "Failed to create signal");
      }
    } finally { setSavingNewSignal(false); }
  }

  const [togglingSignalKey, setTogglingSignalKey] = useState<string | null>(null);

  async function handleToggleSignalEnabled(sig: TenantSignal) {
    const nextEnabled = !(sig.enabled ?? true);
    setTogglingSignalKey(sig.key);
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rules/${encodeURIComponent(sig.key)}/enabled`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      if (res.ok) {
        const apply = (list: TenantSignal[]) =>
          list.map(s => (s.key === sig.key ? { ...s, enabled: nextEnabled } : s));
        setSignals(apply);
        setAdjustmentSignals(apply);
        toast({ title: `Signal "${sig.label}" ${nextEnabled ? "enabled" : "disabled"}` });
      } else {
        const body = await res.json().catch(() => ({}) as { error?: string });
        toast({ title: body.error ?? "Failed to update signal", variant: "destructive" });
      }
    } finally {
      setTogglingSignalKey(null);
    }
  }

  async function handleDeleteSignal(key: string) {
    const res = await fetchWithAuth(`/api/admin/custom-signals/${encodeURIComponent(key)}`, { method: "DELETE" });
    const body = await res.json() as { deleted?: string; error?: string };
    if (res.ok) {
      toast({ title: `Signal "${key}" deleted` });
      if (selectedSignal === key) setSelectedSignal(null);
      setDeletingSignalKey(null);
      await loadAll();
    } else {
      toast({ title: body.error ?? "Delete failed", variant: "destructive" });
      setDeletingSignalKey(null);
    }
  }

  async function handleBundleImport() {
    let parsed: unknown;
    try { parsed = JSON.parse(bundleJson); } catch {
      toast({ title: "Invalid JSON", variant: "destructive" }); return;
    }
    const bundle = parsed as Record<string, unknown>;
    if (!bundle.group || !Array.isArray(bundle.rules)) {
      toast({ title: 'JSON must have "group" and "rules" keys', variant: "destructive" }); return;
    }
    setBundleRunning(true);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules/import-bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bundle),
      });
      const body = await res.json() as { signalKey?: string; groupId?: number; imported?: number; error?: string };
      if (res.ok && body.signalKey) {
        toast({ title: `Bundle imported — ${body.imported} rule(s) added to "${(bundle.group as Record<string,unknown>).label ?? body.signalKey}"` });
        setShowBundleModal(false);
        setBundleJson("");
        await loadAll();
        const isAdj = (body.signalKey as string).startsWith("adj:");
        setSignalSection(isAdj ? "adjustment" : "project");
        setSelectedSignal(body.signalKey);
      } else {
        toast({ title: body.error ?? "Import failed", variant: "destructive" });
      }
    } finally { setBundleRunning(false); }
  }

  async function handleAddGroup() {
    if (!selectedSignal) return;
    setSavingGroup(true);
    try {
      const res = await fetchWithAuth("/api/admin/signal-rule-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signalKey: selectedSignal,
          logic: addGroupForm.logic,
          label: addGroupForm.label.trim() || null,
          ...intelFormToBody(addGroupForm.intel),
        }),
      });
      if (res.ok) {
        toast({ title: "Group added" });
        setAddGroupForm({ logic: "OR", label: "", intel: EMPTY_INTEL_FORM });
        await loadAll();
      } else {
        toast({ title: "Failed to add group", variant: "destructive" });
      }
    } finally { setSavingGroup(false); }
  }

  async function handleSaveEditGroup(id: number) {
    setSavingGroupEdit(true);
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rule-groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editGroupForm.label.trim() || null,
          ...intelFormToBody(editGroupForm.intel),
        }),
      });
      if (res.ok) {
        toast({ title: "Group updated" });
        setEditingGroupId(null);
        await loadAll();
      } else {
        toast({ title: "Failed to update group", variant: "destructive" });
      }
    } finally { setSavingGroupEdit(false); }
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

  async function handleExport() {
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules/export");
      if (!res.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
      const data = await res.json() as unknown;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `signal-rules-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
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
        const data = await res.json() as { imported: number; skipped?: number; errors?: string[]; snapshotId: number; projectLinksUpdated?: number };
        const linkSuffix = data.projectLinksUpdated ? ` ${data.projectLinksUpdated} project link(s) updated.` : "";
        const skippedSuffix = data.skipped ? ` ${data.skipped} skipped.` : "";
        toast({ title: `Imported ${data.imported} rules. Previous rules saved as snapshot.${skippedSuffix}${linkSuffix}` });
        if (data.errors?.length) {
          toast({
            title: `${data.errors.length} validation issue(s) during import`,
            description: data.errors.slice(0, 5).join(" | "),
            variant: "destructive",
          });
        }
        setShowImportModal(false);
        setImportJson("");
        await loadAll();
      } else {
        const errBody = await res.json().catch(() => ({})) as { error?: string };
        toast({ title: "Import failed", description: errBody.error, variant: "destructive" });
      }
    } finally { setImportRunning(false); }
  }

  async function handleSignalImport() {
    if (!selectedSignal) return;
    setSignalImportRunning(true);
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(signalImportJson); }
      catch { toast({ title: "Invalid JSON", variant: "destructive" }); return; }
      const res = await fetchWithAuth(`/api/admin/signal-rules/${encodeURIComponent(selectedSignal)}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (res.ok) {
        const data = await res.json() as { imported: number; signalKey: string };
        toast({ title: `Imported ${data.imported} rule${data.imported === 1 ? "" : "s"} for ${data.signalKey}.` });
        setShowSignalImportModal(false);
        setSignalImportJson("");
        await loadAll();
      } else {
        const err = await res.json().catch(() => ({ error: "Import failed" })) as { error: string };
        toast({ title: err.error ?? "Import failed", variant: "destructive" });
      }
    } finally { setSignalImportRunning(false); }
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
        setExpandedProfileIds(prev => new Set([...prev, id]));
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

  async function handleToggleProject(project: EngagementProject, add: boolean) {
    const newTriggeredBy = add
      ? [...project.triggeredBy, selectedSignal!]
      : project.triggeredBy.filter(k => k !== selectedSignal!);
    const res = await fetchWithAuth(`/api/admin/engagement-projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: project.title,
        priceRange: project.priceRange,
        description: project.description,
        meaning: project.meaning,
        triggeredBy: newTriggeredBy,
        sowItems: project.sowItems,
        pages: project.pages,
        sortOrder: project.sortOrder,
        isVisible: project.isVisible,
      }),
    });
    if (res.ok) {
      toast({ title: add ? "Project linked to signal" : "Project unlinked from signal" });
      await Promise.all([loadAll(), loadEngagementProjects()]);
    } else {
      toast({ title: "Failed to update project", variant: "destructive" });
    }
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
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
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
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-background gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* View switcher */}
          <div className="flex items-center border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setPageView("rules")}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${pageView === "rules" ? "bg-primary text-white" : "bg-background text-muted-foreground hover:text-foreground"}`}
            >
              Signal Rules
            </button>
            <button
              onClick={() => { setPageView("simulate"); void loadSimProfiles(); void loadClientsWithRuns(); }}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 ${pageView === "simulate" ? "bg-primary text-white" : "bg-background text-muted-foreground hover:text-foreground"}`}
            >
              <FlaskConical className="w-3 h-3" /> Simulate
            </button>
          </div>
          {pageView === "rules" && (
            <>
              <button
                onClick={() => { setShowTestModal(true); void loadSimProfiles(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary text-xs font-semibold rounded-lg border border-primary/30 hover:bg-primary/20 transition-colors"
              >
                <Play className="w-3.5 h-3.5" /> Test Evaluation
              </button>
              <button
                onClick={() => { setShowPreviewModal(true); void handlePreviewProjects(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-xs font-semibold rounded-lg border border-border hover:border-primary/40 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" /> Preview Projects
              </button>
              <button
                onClick={() => { setShowDryRunModal(true); void loadClients(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-xs font-semibold rounded-lg border border-border hover:border-primary/40 transition-colors"
              >
                <Zap className="w-3.5 h-3.5" /> Dry-Run SOW
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConflictsPanel(true)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              conflicts.length > 0
                ? "bg-amber-900/20 text-amber-400 border-amber-500/30 hover:bg-amber-900/30"
                : "bg-accent text-muted-foreground border-border"
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {conflicts.length} Conflict{conflicts.length !== 1 ? "s" : ""}
          </button>
        </div>
      </div>

      {/* ── Simulate view ─────────────────────────────────────────────────────── */}
      {pageView === "simulate" && (
        <div className="flex-1 overflow-y-auto bg-background p-6 space-y-6">
          {/* Header row */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">Simulation Profiles</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Test rule changes against saved tenant data snapshots before publishing. Profiles can be created manually or imported directly from a real client's script run history.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setShowFromClientModal(true); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary text-xs font-semibold rounded-lg border border-primary/30 hover:bg-primary/20 transition-colors"
              >
                <Database className="w-3.5 h-3.5" /> Import from Tenant
              </button>
              <button
                onClick={() => { setShowTestModal(true); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-xs font-semibold rounded-lg border border-border hover:border-primary/40 transition-colors"
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
            className="w-full max-w-sm border border-border bg-accent text-foreground/90 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />

          {/* Profile cards */}
          {filteredSimProfiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FlaskConical className="w-10 h-10 text-border mb-3" />
              <p className="text-sm font-semibold text-muted-foreground">No simulation profiles yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm">Import real tenant data or create a manual profile to test signal rules before they affect live SOW generation.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSimProfiles.map(profile => {
                const result = profileRunResults[profile.id];
                const isExpanded = expandedProfileIds.has(profile.id);
                const isRunning = runningProfileId === profile.id;
                return (
                  <div key={profile.id} className="border border-border rounded-xl overflow-hidden bg-card">
                    {/* Profile header */}
                    <div className="flex items-center justify-between px-5 py-3.5 gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button
                          onClick={() => setExpandedProfileIds(prev => { const s = new Set(prev); isExpanded ? s.delete(profile.id) : s.add(profile.id); return s; })}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left"
                        >
                          <ChevronRight className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{profile.name}</p>
                            {profile.description && (
                              <p className="text-xs text-muted-foreground/60 truncate">{profile.description}</p>
                            )}
                          </div>
                        </button>
                        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                          {profile.tags.map(t => (
                            <span key={t} className={`text-xs px-2 py-0.5 rounded-full font-medium ${t === "tenant-import" ? "bg-primary/15 text-primary border border-primary/20" : "bg-border text-muted-foreground"}`}>
                              {t === "tenant-import" ? <><Database className="w-2.5 h-2.5 inline mr-1" />{t}</> : t}
                            </span>
                          ))}
                          {profile.lastRunAt && (
                            <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
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
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                          title="Run simulation"
                        >
                          {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          {isRunning ? "Running…" : "Run"}
                        </button>
                        <button
                          onClick={() => { preloadProfile(profile); setShowTestModal(true); }}
                          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-border/50 rounded transition-colors"
                          title="Edit in test modal"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void handleDeleteSimProfile(profile.id)}
                          className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-900/10 rounded transition-colors"
                          title="Delete profile"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded result */}
                    {isExpanded && result && (
                      <div className="border-t border-border px-5 py-4 space-y-4">

                        {/* ── Delta vs previous run ────────────────────────────── */}
                        {result.previousRunDiff && (() => {
                          const d = result.previousRunDiff!;
                          const hasChanges = d.newlyIncluded.length > 0 || d.movedToExcluded.length > 0 || d.newlyFired.length > 0 || d.stoppedFiring.length > 0;
                          if (!hasChanges) {
                            return (
                              <div className="flex items-center gap-2 px-3 py-2 bg-accent border border-border rounded-lg">
                                <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                                <p className="text-xs text-muted-foreground">No changes from previous run — results are identical.</p>
                              </div>
                            );
                          }
                          return (
                            <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 overflow-hidden">
                              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-500/20">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                                <p className="text-xs font-bold text-amber-400 uppercase tracking-wide">Changes from previous run</p>
                              </div>
                              <div className="px-4 py-3 space-y-3">
                                {(d.newlyIncluded.length > 0 || d.movedToExcluded.length > 0) && (
                                  <div className="grid grid-cols-2 gap-3">
                                    {d.newlyIncluded.length > 0 && (
                                      <div>
                                        <p className="text-xs font-semibold text-green-400 mb-1.5">✓ Now Included ({d.newlyIncluded.length})</p>
                                        <div className="space-y-1">
                                          {d.newlyIncluded.map(p => (
                                            <div key={p.id} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-950/30 border border-green-500/20 rounded-lg">
                                              <TrendingUp className="w-3 h-3 text-green-400 flex-shrink-0" />
                                              <span className="text-xs text-green-300 truncate">{p.title}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {d.movedToExcluded.length > 0 && (
                                      <div>
                                        <p className="text-xs font-semibold text-red-400 mb-1.5">⚠ Moved to Excluded ({d.movedToExcluded.length})</p>
                                        <div className="space-y-1">
                                          {d.movedToExcluded.map(p => (
                                            <div key={p.id} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-950/30 border border-red-500/20 rounded-lg">
                                              <TrendingDown className="w-3 h-3 text-red-400 flex-shrink-0" />
                                              <span className="text-xs text-red-300 truncate">{p.title}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {(d.newlyFired.length > 0 || d.stoppedFiring.length > 0) && (
                                  <div className="grid grid-cols-2 gap-3">
                                    {d.newlyFired.length > 0 && (
                                      <div>
                                        <p className="text-xs font-semibold text-blue-400 mb-1.5">New signals fired ({d.newlyFired.length})</p>
                                        <div className="flex flex-wrap gap-1.5">
                                          {d.newlyFired.map(s => (
                                            <span key={s.key} className="text-xs bg-blue-900/30 text-blue-300 border border-blue-500/20 px-2 py-0.5 rounded-full font-medium">
                                              +{s.label}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {d.stoppedFiring.length > 0 && (
                                      <div>
                                        <p className="text-xs font-semibold text-muted-foreground mb-1.5">Signals stopped ({d.stoppedFiring.length})</p>
                                        <div className="flex flex-wrap gap-1.5">
                                          {d.stoppedFiring.map(s => (
                                            <span key={s.key} className="text-xs bg-border/60 text-muted-foreground/60 border border-border px-2 py-0.5 rounded-full font-medium line-through">
                                              {s.label}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Fired signals */}
                        <div>
                          {(() => {
                            const latestRuleUpdatedAt = rules.reduce<string | null>((max, r) => {
                              if (!r.updatedAt) return max;
                              return !max || r.updatedAt > max ? r.updatedAt : max;
                            }, null);
                            const isStale = !!(profile.lastRunAt && latestRuleUpdatedAt && latestRuleUpdatedAt > profile.lastRunAt);
                            return (
                              <div className="flex items-center flex-wrap gap-2 mb-2">
                                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Signals Fired ({result.firedSignals.length})</p>
                                {profile.lastRunAt && (
                                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent border border-border text-muted-foreground">
                                    <Clock className="w-2.5 h-2.5 flex-shrink-0" />
                                    Run {timeAgo(profile.lastRunAt)}
                                  </span>
                                )}
                                {isStale && (
                                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-900/30 border border-amber-500/30 text-amber-400" title={`Rules last updated ${timeAgo(latestRuleUpdatedAt!)}`}>
                                    <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" />
                                    Rules changed since last run
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                          <div className="flex flex-wrap gap-2">
                            {result.firedSignals.map(s => (
                              <div key={s.key} className="group relative">
                                <span className="text-xs bg-green-900/30 text-green-400 px-2.5 py-1 rounded-full border border-green-500/20 font-medium cursor-help">
                                  <Check className="w-3 h-3 inline mr-1" />{s.label}
                                </span>
                                {s.expectedImpact && (
                                  <div className="hidden group-hover:block absolute bottom-full left-0 mb-2 w-72 bg-accent border border-border rounded-xl p-3 text-xs text-foreground/90 z-50 shadow-xl">
                                    <p className="font-semibold text-foreground mb-1">Why this matters</p>
                                    {s.expectedImpact}
                                  </div>
                                )}
                              </div>
                            ))}
                            {result.firedSignals.length === 0 && (
                              <p className="text-xs text-muted-foreground/60 italic">No signals fired</p>
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
                                    <span className="text-xs text-foreground/90 truncate">{p.title}</span>
                                  </div>
                                  {p.priceRange && (
                                    <span className="text-xs text-muted-foreground/60 flex-shrink-0">{p.priceRange}</span>
                                  )}
                                </div>
                              ))}
                              {result.includedProjects.length === 0 && (
                                <p className="text-xs text-muted-foreground italic px-2">No projects would be included.</p>
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide mb-2">
                              Excluded Projects ({result.excludedProjects.length})
                            </p>
                            <div className="space-y-1.5 max-h-52 overflow-y-auto">
                              {result.excludedProjects.map((e, i) => (
                                <div key={i} className="px-3 py-2 bg-accent rounded-lg">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <X className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
                                    <span className="text-xs text-muted-foreground truncate">{e.project.title}</span>
                                  </div>
                                  <p className="text-xs text-border ml-5 mt-0.5 truncate" title={e.reason}>{e.reason}</p>
                                </div>
                              ))}
                              {result.excludedProjects.length === 0 && (
                                <p className="text-xs text-muted-foreground italic px-2">No projects excluded.</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Expanded but no result yet */}
                    {isExpanded && !result && (
                      <div className="border-t border-border px-5 py-6 text-center">
                        <p className="text-xs text-muted-foreground">Click <strong className="text-foreground/90">Run</strong> to see which projects would be included or excluded for this profile.</p>
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
        <div className="w-72 flex-shrink-0 border-r border-border flex flex-col overflow-hidden bg-background">
          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-bold text-foreground">Signals</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setNewSignalForm({ label: "", key: "", description: "", expectedImpact: "", isAdjustment: signalSection === "adjustment" }); setNewSignalError(null); setShowNewSignalModal(true); }}
                className="p-1.5 text-primary hover:text-white hover:bg-primary rounded transition-colors"
                title="New Signal"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleExport}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                title="Export JSON"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setBundleJson(""); setShowBundleModal(true); }}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                title="Import Bundle (group + rules)"
              >
                <Package className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setShowImportModal(true); }}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                title="Import JSON"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setShowSnapshotsPanel(true); }}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                title="Snapshots"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Section switcher */}
          <div className="flex-shrink-0 flex border-b border-border">
            <button
              onClick={() => { setSignalSection("project"); if (selectedSignal?.startsWith("adj:")) setSelectedSignal(null); }}
              className={`flex-1 py-2 text-xs font-semibold transition-colors border-b-2 ${
                signalSection === "project"
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Project Signals
            </button>
            <button
              onClick={() => { setSignalSection("adjustment"); if (selectedSignal && !selectedSignal.startsWith("adj:")) setSelectedSignal(null); }}
              className={`flex-1 py-2 text-xs font-semibold transition-colors border-b-2 ${
                signalSection === "adjustment"
                  ? "border-[#00B4D8] text-[#00B4D8] bg-[#00B4D8]/5"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Pricing Adjustments
            </button>
          </div>

          {/* Signal list */}
          <div className="flex-1 overflow-y-auto">
            {(signalSection === "project" ? signals : adjustmentSignals).map(sig => {
              const sr = signalRules(sig.key);
              const conflictsForSig = signalConflictCount(sig.key);
              const hasRules = sr.length > 0;
              const hp = health[sig.key];
              const isSelected = selectedSignal === sig.key;

              let dotColor = "bg-muted-foreground/60";
              if (conflictsForSig > 0) dotColor = "bg-amber-400";
              else if (hasRules || sig.key === "alwaysInclude") dotColor = "bg-green-500";
              else if (signalSection === "adjustment") dotColor = "bg-[#00B4D8]/40";

              const isCustom = customSignalKeys.has(sig.key);
              const isConfirmingDelete = deletingSignalKey === sig.key;
              const isEnabled = sig.enabled ?? true;
              const isToggling = togglingSignalKey === sig.key;

              return (
                <div
                  key={sig.key}
                  className={`group relative flex items-center border-b border-border/50 transition-colors ${
                    !isEnabled ? "opacity-50" : ""
                  } ${
                    isSelected
                      ? signalSection === "adjustment"
                        ? "bg-[#00B4D8]/10 border-l-2 border-l-[#00B4D8]"
                        : "bg-primary/10 border-l-2 border-l-primary"
                      : "hover:bg-accent"
                  }`}
                >
                  {isConfirmingDelete ? (
                    <div className="flex-1 flex items-center gap-2 px-4 py-3">
                      <span className="text-xs text-red-400 flex-1">Delete "{sig.label}"?</span>
                      <button
                        onClick={() => void handleDeleteSignal(sig.key)}
                        className="text-xs font-semibold text-red-400 hover:text-red-300 transition-colors"
                      >Yes</button>
                      <button
                        onClick={() => setDeletingSignalKey(null)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >No</button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => { setSelectedSignal(sig.key); setActiveTab("rules"); }}
                        className="flex-1 flex items-center gap-2.5 px-4 py-3 text-left"
                      >
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-foreground truncate">{sig.label}</span>
                            {sr.length > 0 && (
                              <span className="text-xs text-muted-foreground/60 bg-accent px-1.5 py-0.5 rounded font-mono">{sr.length}</span>
                            )}
                            {conflictsForSig > 0 && (
                              <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                            )}
                            {!isEnabled && (
                              <span className="text-[10px] uppercase tracking-wide font-semibold text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">Disabled</span>
                            )}
                          </div>
                          {hp && (
                            <p className="text-xs text-muted-foreground/60 mt-0.5">{hp.clientCount} / {hp.totalClients} clients</p>
                          )}
                        </div>
                        <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${isSelected ? (signalSection === "adjustment" ? "text-[#00B4D8]" : "text-primary") + " rotate-90" : "text-muted-foreground/60"}`} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); void handleToggleSignalEnabled(sig); }}
                        disabled={isToggling}
                        title={isEnabled ? "Disable signal (it will never fire)" : "Enable signal"}
                        aria-label={isEnabled ? `Disable ${sig.label}` : `Enable ${sig.label}`}
                        className={`mr-2 relative inline-flex h-4.5 w-8 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                          isEnabled ? "bg-primary" : "bg-border"
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            isEnabled ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                      {isCustom && (
                        <button
                          onClick={e => { e.stopPropagation(); setDeletingSignalKey(sig.key); }}
                          className="opacity-0 group-hover:opacity-100 mr-2 p-1 text-muted-foreground/60 hover:text-red-400 transition-all rounded"
                          title="Delete signal"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {signalSection === "adjustment" && adjustmentSignals.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <p className="text-xs text-muted-foreground/60">No adjustment signals loaded.</p>
              </div>
            )}
          </div>

          {/* Footer: Script Field Explorer */}
          <div className="flex-shrink-0 border-t border-border p-3">
            <button
              onClick={() => { setShowScriptExplorer(true); void loadScriptFields(); }}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-accent text-muted-foreground text-xs font-semibold rounded-lg hover:text-foreground hover:bg-border/50 transition-colors"
            >
              <Search className="w-3.5 h-3.5" /> Script Field Explorer
            </button>
          </div>
        </div>

        {/* ── Right panel ─────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden flex flex-col bg-background">
          {!selectedSignal ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a signal to configure rules
            </div>
          ) : (
            <>
              {/* Signal header */}
              <div className="flex-shrink-0 px-6 py-4 border-b border-border">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-lg font-bold text-foreground">{selectedSignalData?.label}</h2>
                  <code className="text-xs bg-accent text-[#00B4D8] px-2 py-0.5 rounded font-mono border border-border">{selectedSignal}</code>
                  <button
                    onClick={() => { setSignalImportJson(""); setShowSignalImportModal(true); }}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 bg-accent text-muted-foreground text-xs font-semibold rounded-lg border border-border hover:text-foreground hover:border-primary/40 transition-colors"
                    title="Import JSON rules for this signal"
                  >
                    <Upload className="w-3.5 h-3.5" /> Import Rules
                  </button>
                </div>
                {selectedSignalData?.description && (
                  <p className="text-sm text-muted-foreground mt-1">{selectedSignalData.description}</p>
                )}
              </div>

              {/* Tabs */}
              <div className="flex-shrink-0 flex gap-0 border-b border-border">
                {(["rules", "projects", "docs", "audit"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-5 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
                      activeTab === tab
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab === "docs" ? "Documentation" : tab === "audit" ? "Audit Log" : tab === "projects" ? "Projects" : "Rules"}
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
                        <div key={group.id} className="border border-border rounded-xl overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-2.5 bg-accent border-b border-border">
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
                              <span className="text-sm font-semibold text-foreground/90">{group.label ?? `Group ${group.id}`}</span>
                              {group.category && (
                                <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full">{group.category}</span>
                              )}
                              {group.severity && (
                                <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full">{group.severity}</span>
                              )}
                              {(group.priority != null || group.weight != null) && (
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {group.priority != null ? `p${group.priority}` : ""}{group.priority != null && group.weight != null ? " · " : ""}{group.weight != null ? `w${group.weight}` : ""}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  if (editingGroupId === group.id) { setEditingGroupId(null); return; }
                                  setEditingGroupId(group.id);
                                  setEditGroupForm({ label: group.label ?? "", intel: intelFormFromRow(group) });
                                }}
                                className="text-muted-foreground hover:text-primary transition-colors"
                                title="Edit group intelligence fields"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => void handleDeleteGroup(group.id)} className="text-muted-foreground/60 hover:text-red-500 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          {editingGroupId === group.id && (
                            <div className="px-4 py-3 bg-card border-b border-border space-y-2">
                              <input
                                value={editGroupForm.label}
                                onChange={e => setEditGroupForm(f => ({ ...f, label: e.target.value }))}
                                placeholder="Label (optional)"
                                className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                              />
                              <IntelligenceFieldsPanel value={editGroupForm.intel} onChange={intel => setEditGroupForm(f => ({ ...f, intel }))} compact />
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  onClick={() => void handleSaveEditGroup(group.id)}
                                  disabled={savingGroupEdit}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                >
                                  {savingGroupEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                                </button>
                                <button
                                  onClick={() => setEditingGroupId(null)}
                                  className="px-3 py-1.5 bg-accent text-foreground/90 text-xs rounded-lg hover:bg-border transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="divide-y divide-border/50">
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
                                onEdit={r => { setEditRuleConflictError(null); setEditingRuleId(r.id); setEditRuleForm({ ruleType: r.ruleType, sourceKey: r.sourceKey, compareValue: r.compareValue ?? "", description: r.description ?? "", intel: intelFormFromRow(r) }); }}
                                onSave={() => void handleSaveEditRule(rule.id)}
                                onDelete={() => void handleDeleteRule(rule.id)}
                                editRuleConflictError={editingRuleId === rule.id ? editRuleConflictError : null}
                              />
                            ))}
                            {groupRules.length === 0 && (
                              <p className="px-4 py-3 text-xs text-muted-foreground/60 italic">No rules in this group yet — add rules below and assign them to this group.</p>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Ungrouped rules */}
                    {selectedRules.filter(r => r.groupId === null || r.groupId === undefined).length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Ungrouped Rules (each acts as its own OR condition)</p>
                        <div className="border border-border rounded-xl divide-y divide-border/50 overflow-hidden">
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
                              onEdit={r => { setEditRuleConflictError(null); setEditingRuleId(r.id); setEditRuleForm({ ruleType: r.ruleType, sourceKey: r.sourceKey, compareValue: r.compareValue ?? "", description: r.description ?? "", intel: intelFormFromRow(r) }); }}
                              onSave={() => void handleSaveEditRule(rule.id)}
                              onDelete={() => void handleDeleteRule(rule.id)}
                              editRuleConflictError={editingRuleId === rule.id ? editRuleConflictError : null}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedRules.length === 0 && selectedGroups.length === 0 && (
                      <p className="text-sm text-muted-foreground italic">No rules configured for this signal yet.</p>
                    )}

                    {/* Add rule form */}
                    <div className="border border-dashed border-border rounded-xl p-5 space-y-4">
                      <p className="text-xs font-bold text-foreground/90 uppercase tracking-wide">Add Rule</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-muted-foreground mb-1">Rule Type</label>
                          <select
                            value={addRuleForm.ruleType}
                            onChange={e => setAddRuleForm(f => ({ ...f, ruleType: e.target.value }))}
                            className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            {RULE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-muted-foreground mb-1">
                            {addRuleForm.ruleType === "findings_keyword" ? "Keyword" : "Profile Key"}
                          </label>
                          <input
                            value={addRuleForm.sourceKey}
                            onChange={e => setAddRuleForm(f => ({ ...f, sourceKey: e.target.value }))}
                            placeholder="e.g. mfaEnforced"
                            className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {needsCompareValue(addRuleForm.ruleType) && (
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">Compare Value</label>
                            <input
                              value={addRuleForm.compareValue}
                              onChange={e => setAddRuleForm(f => ({ ...f, compareValue: e.target.value }))}
                              placeholder="e.g. 60"
                              className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                            />
                          </div>
                        )}
                        <div>
                          <label className="block text-xs text-muted-foreground mb-1">Group (optional)</label>
                          <select
                            value={addRuleForm.groupId}
                            onChange={e => setAddRuleForm(f => ({ ...f, groupId: e.target.value }))}
                            className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            <option value="">— Ungrouped —</option>
                            {selectedGroups.map(g => (
                              <option key={g.id} value={g.id}>{g.label ?? `Group ${g.id}`} ({g.logic})</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">Description (optional)</label>
                        <input
                          value={addRuleForm.description}
                          onChange={e => setAddRuleForm(f => ({ ...f, description: e.target.value }))}
                          placeholder="Why does this rule matter?"
                          className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                      </div>
                      <div className="rounded-lg border border-border bg-background/40 p-3">
                        <IntelligenceFieldsPanel value={addRuleForm.intel} onChange={intel => setAddRuleForm(f => ({ ...f, intel }))} compact />
                      </div>
                      {addRuleConflictError && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-semibold text-amber-300 mb-0.5">Rule not saved — conflict detected</p>
                            <p className="text-xs text-amber-300/80 leading-snug">{addRuleConflictError}</p>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          onClick={() => void handleAddRule()}
                          disabled={savingRule || !addRuleForm.sourceKey.trim()}
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          {savingRule ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add Rule
                        </button>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Add Group:</span>
                          <select
                            value={addGroupForm.logic}
                            onChange={e => setAddGroupForm(f => ({ ...f, logic: e.target.value as "AND" | "OR" }))}
                            className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs focus:outline-none"
                          >
                            <option value="OR">OR</option>
                            <option value="AND">AND</option>
                          </select>
                          <input
                            value={addGroupForm.label}
                            onChange={e => setAddGroupForm(f => ({ ...f, label: e.target.value }))}
                            placeholder="Label (optional)"
                            className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs focus:outline-none w-36"
                          />
                          <button
                            onClick={() => setShowAddGroupIntel(v => !v)}
                            className="px-2 py-1 bg-accent text-muted-foreground text-xs rounded hover:bg-border transition-colors"
                          >
                            {showAddGroupIntel ? "Hide fields" : "More fields"}
                          </button>
                          <button
                            onClick={() => void handleAddGroup()}
                            disabled={savingGroup}
                            className="px-2 py-1 bg-accent text-foreground/90 text-xs rounded hover:bg-border transition-colors"
                          >
                            {savingGroup ? <Loader2 className="w-3 h-3 animate-spin" /> : "+"}
                          </button>
                        </div>
                      </div>
                      {showAddGroupIntel && (
                        <div className="rounded-lg border border-border bg-background/40 p-3 mt-2">
                          <IntelligenceFieldsPanel value={addGroupForm.intel} onChange={intel => setAddGroupForm(f => ({ ...f, intel }))} compact />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Documentation tab ─────────────────────────────────────── */}
                {activeTab === "docs" && selectedSignalData && (
                  <div className="space-y-8 max-w-2xl">
                    <div>
                      <h3 className="text-sm font-bold text-foreground uppercase tracking-wide mb-2">Expected Impact</h3>
                      <p className="text-sm text-foreground/90 leading-relaxed bg-accent rounded-xl p-4 border border-border">
                        {selectedSignalData.expectedImpact}
                      </p>
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-foreground uppercase tracking-wide mb-2">Projects Unlocked by This Signal</h3>
                      {(selectedSignalData.unlocksProjects ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">No projects are currently triggered by this signal — set triggeredBy on an Engagement Project to link one.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {(selectedSignalData.unlocksProjects ?? []).map(p => (
                            <a
                              key={p.id}
                              href="/admin-panel/delivery/engagement-projects"
                              className="text-xs bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 rounded-full hover:bg-primary/20 transition-colors"
                            >
                              {p.title}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>

                    {selectedSignalData.recommendedRules.length > 0 && (
                      <div>
                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wide mb-2">Recommended Rule Patterns</h3>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border border-border rounded-xl overflow-hidden">
                            <thead>
                              <tr className="bg-accent text-muted-foreground text-xs">
                                <th className="text-left px-4 py-2.5">Rule Type</th>
                                <th className="text-left px-4 py-2.5">Source Key</th>
                                <th className="text-left px-4 py-2.5">Value</th>
                                <th className="text-left px-4 py-2.5">Rationale</th>
                                <th className="px-4 py-2.5"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {selectedSignalData.recommendedRules.map((r, i) => (
                                <tr key={i} className="bg-background">
                                  <td className="px-4 py-2.5">{ruleTypePill(r.ruleType)}</td>
                                  <td className="px-4 py-2.5 font-mono text-xs text-foreground/90">{r.sourceKey}</td>
                                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{r.compareValue ?? "—"}</td>
                                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.rationale}</td>
                                  <td className="px-4 py-2.5">
                                    <button
                                      onClick={() => applyRulePreset(r)}
                                      className="text-xs text-primary hover:underline whitespace-nowrap"
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

                {/* ── Projects tab ───────────────────────────────────────────── */}
                {activeTab === "projects" && (
                  <div className="space-y-6">
                    <div>
                      <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-3">
                        Linked to this signal
                        <span className="ml-2 text-muted-foreground/60 font-normal normal-case">({associatedProjects.length})</span>
                      </p>
                      {projectsLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
                      ) : associatedProjects.length === 0 ? (
                        <p className="text-sm text-muted-foreground/60 italic">No engagement projects linked yet — add one from the list below.</p>
                      ) : (
                        <div className="space-y-2">
                          {associatedProjects.map(p => (
                            <div key={p.id} className="flex items-center justify-between px-4 py-3 bg-primary/5 rounded-xl border border-primary/20">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate">{p.title}</p>
                                <p className="text-xs text-muted-foreground">{p.priceRange}</p>
                              </div>
                              <button
                                onClick={() => void handleToggleProject(p, false)}
                                className="ml-4 flex-shrink-0 text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-400/50 px-2.5 py-1 rounded-lg transition-colors"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">
                        Available to link
                        <span className="ml-2 font-normal normal-case">({availableProjects.length})</span>
                      </p>
                      {!projectsLoading && availableProjects.length === 0 && (
                        <p className="text-sm text-muted-foreground/60 italic">All engagement projects are already linked to this signal.</p>
                      )}
                      {!projectsLoading && (
                        <div className="space-y-2">
                          {availableProjects.map(p => (
                            <div key={p.id} className="flex items-center justify-between px-4 py-3 bg-background rounded-xl border border-border hover:border-primary/30 transition-colors">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground/90 truncate">{p.title}</p>
                                <p className="text-xs text-muted-foreground/60">{p.priceRange}</p>
                              </div>
                              <button
                                onClick={() => void handleToggleProject(p, true)}
                                className="ml-4 flex-shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:text-[#1A91E8] border border-primary/30 hover:border-primary/60 px-2.5 py-1 rounded-lg transition-colors"
                              >
                                <Plus className="w-3 h-3" /> Add
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Audit Log tab ──────────────────────────────────────────── */}
                {activeTab === "audit" && (
                  <div>
                    {auditLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
                    ) : auditLog.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">No audit log entries for this signal yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {auditLog.map(entry => (
                          <div key={entry.id} className="flex items-start gap-3 p-3 bg-accent rounded-lg border border-border">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${
                              entry.action === "create" ? "bg-green-900/30 text-green-400" :
                              entry.action === "delete" ? "bg-red-900/30 text-red-400" :
                              entry.action === "import" ? "bg-blue-900/30 text-blue-400" :
                              entry.action === "restore_version" ? "bg-purple-900/30 text-purple-400" :
                              "bg-border text-muted-foreground"
                            }`}>{entry.action}</span>
                            <div className="flex-1 min-w-0">
                              {entry.note && <p className="text-xs text-foreground/90">{entry.note}</p>}
                              {entry.ruleId && <p className="text-xs text-muted-foreground">Rule #{entry.ruleId}</p>}
                            </div>
                            <span className="text-xs text-muted-foreground/60 flex-shrink-0">{new Date(entry.createdAt).toLocaleString()}</span>
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
            <div className="w-64 flex-shrink-0 flex flex-col border border-border rounded-xl overflow-hidden">
              <div className="flex-shrink-0 px-3 py-2 border-b border-border bg-accent">
                <p className="text-xs font-bold text-foreground/90">Saved Profiles</p>
                <input
                  value={simProfileSearch}
                  onChange={e => setSimProfileSearch(e.target.value)}
                  placeholder="Search…"
                  className="mt-1.5 w-full border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs focus:outline-none"
                />
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-border/50">
                {filteredSimProfiles.map(p => (
                  <div key={p.id} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{p.name}</p>
                        {p.tags.length > 0 && (
                          <div className="flex flex-wrap gap-0.5 mt-0.5">
                            {p.tags.map(t => (
                              <span key={t} className="text-xs bg-border text-muted-foreground px-1.5 py-0.5 rounded-full">{t}</span>
                            ))}
                          </div>
                        )}
                        {p.lastRunAt && (
                          <p className="text-xs text-muted-foreground/60 mt-0.5 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {new Date(p.lastRunAt).toLocaleDateString()}
                            {p.lastRunResult && (
                              <span className={`ml-1 w-1.5 h-1.5 rounded-full ${p.lastRunResult.length > 1 ? "bg-green-500" : "bg-amber-500"}`} />
                            )}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => preloadProfile(p)} className="p-1 text-muted-foreground hover:text-primary transition-colors" title="Load">
                          <Download className="w-3 h-3" />
                        </button>
                        <button onClick={() => void handleRunSimProfile(p.id)} className="p-1 text-muted-foreground hover:text-green-400 transition-colors" title="Run">
                          <Play className="w-3 h-3" />
                        </button>
                        <button onClick={() => void handleDeleteSimProfile(p.id)} className="p-1 text-muted-foreground hover:text-red-500 transition-colors" title="Delete">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredSimProfiles.length === 0 && (
                  <p className="px-3 py-4 text-xs text-muted-foreground/60 italic">No profiles yet.</p>
                )}
              </div>
              <div className="flex-shrink-0 border-t border-border p-3 space-y-1.5">
                <p className="text-xs text-muted-foreground font-semibold">Save current JSON as profile</p>
                <input
                  value={newProfileForm.name}
                  onChange={e => setNewProfileForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Profile name"
                  className="w-full border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs focus:outline-none"
                />
                <input
                  value={newProfileForm.tags}
                  onChange={e => setNewProfileForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="Tags (comma-separated)"
                  className="w-full border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs focus:outline-none"
                />
                <button
                  onClick={() => void handleSaveSimProfile()}
                  disabled={savingProfile || !newProfileForm.name.trim()}
                  className="w-full px-2 py-1.5 bg-primary/10 text-primary text-xs font-semibold rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
                >
                  {savingProfile ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Save Profile"}
                </button>
              </div>
            </div>

            {/* Right: JSON editor + results */}
            <div className="flex-1 flex flex-col gap-4 overflow-hidden">
              <div className="flex-1 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground font-semibold">JSON Input</label>
                  <button
                    onClick={() => void handleRunTest()}
                    disabled={testRunning}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {testRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Run
                  </button>
                </div>
                <textarea
                  value={testJson}
                  onChange={e => setTestJson(e.target.value)}
                  className="flex-1 border border-border bg-background text-foreground/90 rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                  spellCheck={false}
                />
              </div>

              {testResult && (
                <div className="flex-1 overflow-y-auto space-y-4">
                  <div>
                    <p className="text-xs font-bold text-foreground/90 uppercase tracking-wide mb-2">Fired Signals</p>
                    <div className="flex flex-wrap gap-2">
                      {testResult.firedSignals.map(s => (
                        <div key={s.key} className="group relative">
                          <span className="text-xs bg-green-900/30 text-green-400 px-2.5 py-1 rounded-full border border-green-500/20 font-medium cursor-help">
                            <Check className="w-3 h-3 inline mr-1" />{s.label}
                          </span>
                          {s.expectedImpact && (
                            <div className="hidden group-hover:block absolute bottom-full left-0 mb-2 w-72 bg-accent border border-border rounded-xl p-3 text-xs text-foreground/90 z-50 shadow-xl">
                              <p className="font-semibold text-foreground mb-1">Why this matters</p>
                              {s.expectedImpact}
                            </div>
                          )}
                        </div>
                      ))}
                      {testResult.firedSignals.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">No signals fired</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-foreground/90 uppercase tracking-wide mb-2">Rule Trace</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border border-border rounded-xl overflow-hidden">
                        <thead>
                          <tr className="bg-accent text-muted-foreground">
                            <th className="text-left px-3 py-2">Signal</th>
                            <th className="text-left px-3 py-2">Rule #</th>
                            <th className="text-left px-3 py-2">Result</th>
                            <th className="text-left px-3 py-2">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {testResult.ruleTrace.map((t, i) => (
                            <tr key={i} className={t.result ? "bg-green-950/20" : "bg-background"}>
                              <td className="px-3 py-1.5 font-mono">{t.signalKey}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{t.ruleId}</td>
                              <td className="px-3 py-1.5">{t.result ? <Check className="w-3 h-3 text-green-400" /> : <X className="w-3 h-3 text-muted-foreground/60" />}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{t.reason}</td>
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
              <p className="text-sm text-muted-foreground">Projects that would be included based on current JSON in Test Evaluation.</p>
              <button
                onClick={() => void handlePreviewProjects()}
                disabled={previewRunning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg disabled:opacity-50"
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
                      <div key={p.id} className="flex items-center gap-2 text-sm text-foreground/90">
                        <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" /> {p.title}
                      </div>
                    ))}
                    {previewResult.included.length === 0 && <p className="text-sm text-muted-foreground italic">None</p>}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Excluded ({previewResult.excluded.length})</p>
                  <div className="space-y-1.5">
                    {previewResult.excluded.map((e: { project: { id: number; title: string }; reason: string }, i: number) => (
                      <div key={i} className="text-sm text-muted-foreground/60" title={e.reason}>
                        <X className="w-3.5 h-3.5 inline mr-1.5 text-muted-foreground/60" />{e.project.title}
                        <p className="text-xs text-border ml-5">{e.reason}</p>
                      </div>
                    ))}
                    {previewResult.excluded.length === 0 && <p className="text-sm text-muted-foreground italic">None excluded</p>}
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
              <label className="block text-xs text-muted-foreground mb-1.5">Select client</label>
              <select
                value={dryRunClientId}
                onChange={e => setDryRunClientId(e.target.value)}
                className="w-full border border-border bg-background text-foreground/90 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
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
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg disabled:opacity-50"
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
                    <p key={i} className="text-sm text-foreground/90 flex items-center gap-1.5 mb-1"><Check className="w-3.5 h-3.5 text-green-400" /> {p.title}</p>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Excluded Projects</p>
                  {dryRunResult.excludedProjects.map((e, i) => (
                    <div key={i} className="mb-1">
                      <p className="text-sm text-muted-foreground/60 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> {e.project.title}</p>
                      <p className="text-xs text-border ml-5">{e.reason}</p>
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
            <p className="text-sm text-muted-foreground italic">No conflicts detected.</p>
          ) : (
            <div className="space-y-3">
              {conflicts.map((c, i) => (
                <div key={i} className="p-4 bg-amber-900/10 border border-amber-500/20 rounded-xl">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-foreground/90">{c.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">Rule IDs: {c.ruleIds.join(", ")}</p>
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
                className="flex-1 border border-border bg-background text-foreground/90 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                onClick={() => void handleSaveSnapshot()}
                disabled={savingSnapshot || !snapshotName.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {savingSnapshot ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
              </button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {versions.map(v => (
                <div key={v.id} className="flex items-center justify-between p-3 bg-accent rounded-xl border border-border">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{v.name}</p>
                    <p className="text-xs text-muted-foreground">{v.ruleCount} rules · {new Date(v.createdAt).toLocaleString()}</p>
                  </div>
                  <button
                    onClick={() => void handleRestoreVersion(v.id, v.name)}
                    className="text-xs text-primary hover:underline"
                  >
                    Restore
                  </button>
                </div>
              ))}
              {versions.length === 0 && <p className="text-sm text-muted-foreground italic">No snapshots yet.</p>}
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
              className="w-full border border-border bg-background text-foreground/90 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {filteredScriptFields.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No script fields found. Run some scripts first.</p>
            ) : (
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-sm border border-border rounded-xl overflow-hidden">
                  <thead>
                    <tr className="bg-accent text-muted-foreground text-xs">
                      <th className="text-left px-4 py-2.5">Key</th>
                      <th className="text-left px-4 py-2.5">Type</th>
                      <th className="text-left px-4 py-2.5">Examples</th>
                      <th className="text-left px-4 py-2.5">Seen in</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredScriptFields.map(f => (
                      <tr key={f.key} className="bg-background">
                        <td className="px-4 py-2.5 font-mono text-xs text-foreground/90">{f.key}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            f.type === "boolean" ? "bg-green-900/30 text-green-400" :
                            f.type === "number" ? "bg-blue-900/30 text-blue-400" :
                            "bg-border text-muted-foreground"
                          }`}>{f.type}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{f.examples.map(e => JSON.stringify(e)).join(", ")}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground/60">{f.seenInNRuns} run{f.seenInNRuns !== 1 ? "s" : ""}</td>
                        <td className="px-4 py-2.5">
                          <button onClick={() => applyScriptFieldToRule(f.key)} className="text-xs text-primary hover:underline">
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
            <p className="text-sm text-muted-foreground">Paste JSON below. Current rules will be backed up as a snapshot before import.</p>
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-sm rounded-lg border border-border hover:border-primary/40 transition-colors"
            >
              <Upload className="w-4 h-4" /> Upload JSON File
            </button>
            <textarea
              value={importJson}
              onChange={e => setImportJson(e.target.value)}
              rows={10}
              placeholder='{"rules": [...], "groups": [...]}'
              className="w-full border border-border bg-background text-foreground/90 rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowImportModal(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
              <button
                onClick={() => void handleImport()}
                disabled={importRunning || !importJson.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {importRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Import
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Bundle Import Modal */}
      {showBundleModal && (
        <Modal title="Import Bundle" onClose={() => { setShowBundleModal(false); setBundleJson(""); }}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Paste a <code className="text-xs bg-accent text-[#00B4D8] px-1 py-0.5 rounded font-mono border border-border">{"{ group, rules }"}</code> bundle.
              A new group is created on <code className="text-xs bg-accent text-[#00B4D8] px-1 py-0.5 rounded font-mono border border-border">group.signalKey</code> and all rules are added into it.
              Existing rules for that signal are <strong className="text-foreground/90">not</strong> removed — the bundle appends a new group.
            </p>

            {/* Live preview */}
            {(() => {
              try {
                const p = JSON.parse(bundleJson) as Record<string, unknown>;
                const g = p.group as Record<string, unknown> | undefined;
                const r = p.rules as unknown[] | undefined;
                if (g && Array.isArray(r)) {
                  return (
                    <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 space-y-1">
                      <p className="text-xs font-bold text-primary uppercase tracking-wide">Preview</p>
                      <p className="text-sm text-foreground">
                        Signal: <code className="font-mono text-[#00B4D8]">{String(g.signalKey ?? "—")}</code>
                      </p>
                      <p className="text-sm text-foreground/90">
                        Group: <span className="font-semibold">{String(g.label ?? "—")}</span> ({String(g.logic ?? "OR")})
                      </p>
                      <p className="text-sm text-muted-foreground">{r.length} rule{r.length !== 1 ? "s" : ""} will be created</p>
                    </div>
                  );
                }
              } catch { /* not parseable yet */ }
              return null;
            })()}

            <input
              ref={bundleFileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => { setBundleJson(ev.target?.result as string ?? ""); };
                reader.readAsText(file);
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-2">
              <label className="block text-xs text-muted-foreground">JSON</label>
              <button
                onClick={() => bundleFileRef.current?.click()}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground underline transition-colors"
              >Upload file</button>
            </div>
            <textarea
              value={bundleJson}
              onChange={e => setBundleJson(e.target.value)}
              rows={12}
              placeholder={'{\n  "group": { "signalKey": "adj:my-signal", "logic": "OR", "label": "My Group" },\n  "rules": [ ... ]\n}'}
              className="w-full border border-border bg-background text-foreground/90 rounded px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            />
            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => { setShowBundleModal(false); setBundleJson(""); }}
                className="px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >Cancel</button>
              <button
                onClick={() => void handleBundleImport()}
                disabled={bundleRunning || !bundleJson.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {bundleRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
                Import Bundle
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* New Signal Modal */}
      {showNewSignalModal && (
        <Modal title="New Signal" onClose={() => setShowNewSignalModal(false)}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create a custom signal. Once created, select it in the left panel to add rules to it.
            </p>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Label <span className="text-red-400">*</span></label>
              <input
                value={newSignalForm.label}
                onChange={e => {
                  const lbl = e.target.value;
                  setNewSignalForm(f => ({
                    ...f,
                    label: lbl,
                    key: f.key || lbl.toLowerCase().replace(/[^a-z0-9:_-]+/g, "-"),
                  }));
                }}
                placeholder="e.g. Teams Rooms Deployment"
                className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Signal Key</label>
              <input
                value={newSignalForm.key}
                onChange={e => setNewSignalForm(f => ({ ...f, key: e.target.value }))}
                placeholder="auto-generated from label"
                className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <p className="text-[10px] text-muted-foreground/60 mt-1">Lowercase letters, numbers, hyphens and colons only. Cannot match a built-in signal key.</p>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Description</label>
              <input
                value={newSignalForm.description}
                onChange={e => setNewSignalForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What does this signal detect?"
                className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Expected Impact</label>
              <input
                value={newSignalForm.expectedImpact}
                onChange={e => setNewSignalForm(f => ({ ...f, expectedImpact: e.target.value }))}
                placeholder="What happens in the SOW when this signal fires?"
                className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Signal Type</label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={!newSignalForm.isAdjustment}
                    onChange={() => setNewSignalForm(f => ({ ...f, isAdjustment: false }))}
                    className="accent-primary"
                  />
                  <span className="text-sm text-foreground/90">Project Signal</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={newSignalForm.isAdjustment}
                    onChange={() => setNewSignalForm(f => ({ ...f, isAdjustment: true }))}
                    className="accent-[#00B4D8]"
                  />
                  <span className="text-sm text-foreground/90">Pricing Adjustment</span>
                </label>
              </div>
            </div>
            {newSignalError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-300">{newSignalError}</p>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => setShowNewSignalModal(false)}
                className="px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >Cancel</button>
              <button
                onClick={() => void handleCreateSignal()}
                disabled={savingNewSignal || !newSignalForm.label.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {savingNewSignal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Create Signal
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Per-signal Import Modal */}
      {showSignalImportModal && selectedSignal && (
        <Modal title={`Import Rules — ${selectedSignal}`} onClose={() => { setShowSignalImportModal(false); setSignalImportJson(""); }}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Paste a JSON array of rules for <code className="text-xs bg-accent text-[#00B4D8] px-1.5 py-0.5 rounded font-mono border border-border">{selectedSignal}</code>.
              Existing rules for this signal will be replaced. Other signals are unaffected.
            </p>
            <input
              ref={signalFileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => setSignalImportJson(ev.target?.result as string);
                reader.readAsText(file);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => signalFileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-sm rounded-lg border border-border hover:border-primary/40 transition-colors"
            >
              <Upload className="w-4 h-4" /> Upload JSON File
            </button>
            <textarea
              value={signalImportJson}
              onChange={e => setSignalImportJson(e.target.value)}
              rows={12}
              placeholder={`[
  {
    "signalKey": "${selectedSignal}",
    "ruleType": "profile_key_truthy",
    "sourceKey": "someField",
    "description": "Description here"
  }
]`}
              className="w-full border border-border bg-background text-foreground/90 rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowSignalImportModal(false); setSignalImportJson(""); }}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSignalImport()}
                disabled={signalImportRunning || !signalImportJson.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {signalImportRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Import
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Import from Tenant Modal */}
      {showFromClientModal && (
        <Modal title="Import from Tenant" onClose={() => { setShowFromClientModal(false); setFromClientSearch(""); setFromClientId(""); setFromClientName(""); }} wide>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select a client to pull their most recent script run results. A simulation profile will be created from the merged <code className="text-xs bg-accent px-1 rounded">profileUpdates</code> and <code className="text-xs bg-accent px-1 rounded">parsedFindings</code> across all completed runs.
            </p>

            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Search client</label>
              <input
                value={fromClientSearch}
                onChange={e => { setFromClientSearch(e.target.value); setFromClientId(""); setFromClientName(""); }}
                placeholder="Name, email, or company…"
                className="w-full border border-border bg-background text-foreground/90 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            {fromClientSearch && (
              <div className="border border-border rounded-lg overflow-hidden max-h-52 overflow-y-auto">
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
                      className={`w-full text-left px-4 py-2.5 text-sm border-b border-border/50 last:border-0 transition-colors ${fromClientId === String(c.id) ? "bg-primary/10 text-primary" : "text-foreground/90 hover:bg-accent"}`}
                    >
                      <span className="font-medium">{c.name ?? "—"}</span>
                      <span className="text-muted-foreground ml-2">{c.email}</span>
                      {c.company && <span className="text-muted-foreground/60 ml-1">· {c.company}</span>}
                      <span className="ml-2 text-xs text-muted-foreground/60">{c.runCount} run{c.runCount !== 1 ? "s" : ""}</span>
                    </button>
                  ))}
                {clientsWithRuns.filter(c =>
                  c.email.toLowerCase().includes(fromClientSearch.toLowerCase()) ||
                  (c.name ?? "").toLowerCase().includes(fromClientSearch.toLowerCase()) ||
                  (c.company ?? "").toLowerCase().includes(fromClientSearch.toLowerCase())
                ).length === 0 && (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No clients with completed script runs found.</p>
                )}
              </div>
            )}

            {!fromClientSearch && clientsWithRuns.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                {clientsWithRuns.slice(0, 10).map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setFromClientId(String(c.id)); setFromClientName(c.name ?? c.email); setFromClientSearch(`${c.name ?? c.email}${c.company ? ` (${c.company})` : ""}`); }}
                    className={`w-full text-left px-4 py-2.5 text-sm border-b border-border/50 last:border-0 transition-colors ${fromClientId === String(c.id) ? "bg-primary/10 text-primary" : "text-foreground/90 hover:bg-accent"}`}
                  >
                    <span className="font-medium">{c.name ?? "—"}</span>
                    <span className="text-muted-foreground ml-2">{c.email}</span>
                    {c.company && <span className="text-muted-foreground/60 ml-1">· {c.company}</span>}
                    <span className="ml-2 text-xs text-muted-foreground/60">{c.runCount} run{c.runCount !== 1 ? "s" : ""} · last {new Date(c.lastRunAt).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            )}

            {!fromClientSearch && clientsWithRuns.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No clients with completed script runs found. Run some assessment scripts first.</p>
            )}

            {fromClientId && (
              <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg">
                <Check className="w-4 h-4 text-primary flex-shrink-0" />
                <p className="text-sm text-foreground/90">
                  Will create a simulation profile from <strong className="text-foreground">{fromClientName}</strong>'s script run history.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => { setShowFromClientModal(false); setFromClientSearch(""); setFromClientId(""); setFromClientName(""); }}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleImportFromClient()}
                disabled={importingFromClient || !fromClientId}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
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
      <div className={`bg-card rounded-2xl shadow-2xl border border-border flex flex-col w-full ${wide ? "max-w-4xl" : "max-w-xl"} max-h-[90vh]`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h3 className="text-base font-bold text-foreground">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
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
  deletingRuleId, savingRule, onEdit, onSave, onDelete, editRuleConflictError,
}: {
  rule: SignalRule;
  conflictRuleIds: Set<number>;
  conflicts: Conflict[];
  editingRuleId: number | null;
  editRuleForm: { ruleType: string; sourceKey: string; compareValue: string; description: string; intel: IntelFormFields };
  setEditRuleForm: (f: typeof editRuleForm) => void;
  setEditingRuleId: (id: number | null) => void;
  deletingRuleId: number | null;
  savingRule: boolean;
  onEdit: (r: SignalRule) => void;
  onSave: () => void;
  onDelete: () => void;
  editRuleConflictError: string | null;
}) {
  const isConflict = conflictRuleIds.has(rule.id);
  const conflictText = conflicts.find(c => c.ruleIds.includes(rule.id))?.description;
  const isEditing = editingRuleId === rule.id;

  if (isEditing) {
    return (
      <div className="px-4 py-3 bg-accent space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select
            value={editRuleForm.ruleType}
            onChange={e => setEditRuleForm({ ...editRuleForm, ruleType: e.target.value })}
            className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs"
          >
            {RULE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            value={editRuleForm.sourceKey}
            onChange={e => setEditRuleForm({ ...editRuleForm, sourceKey: e.target.value })}
            className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs font-mono"
            placeholder="Source key"
          />
        </div>
        {needsCompareValue(editRuleForm.ruleType) && (
          <input
            value={editRuleForm.compareValue}
            onChange={e => setEditRuleForm({ ...editRuleForm, compareValue: e.target.value })}
            className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs font-mono w-32"
            placeholder="Value"
          />
        )}
        <input
          value={editRuleForm.description}
          onChange={e => setEditRuleForm({ ...editRuleForm, description: e.target.value })}
          className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs w-full"
          placeholder="Description"
        />
        <div className="rounded border border-border bg-background/40 p-2">
          <IntelligenceFieldsPanel value={editRuleForm.intel} onChange={intel => setEditRuleForm({ ...editRuleForm, intel })} compact />
        </div>
        {editRuleConflictError && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300 leading-snug">{editRuleConflictError}</p>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onSave} disabled={savingRule} className="px-3 py-1 bg-primary text-white text-xs rounded hover:bg-primary/90 disabled:opacity-50">
            {savingRule ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
          </button>
          <button onClick={() => { setEditingRuleId(null); }} className="px-3 py-1 bg-accent text-muted-foreground text-xs rounded hover:text-foreground">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 group">
      {ruleTypePill(rule.ruleType)}
      <code className="text-xs text-foreground/90 font-mono flex-1 truncate">{rule.sourceKey}</code>
      {rule.compareValue && (
        <code className="text-xs text-muted-foreground font-mono">{rule.compareValue}</code>
      )}
      {rule.description && <p className="text-xs text-muted-foreground/60 truncate max-w-32">{rule.description}</p>}
      {rule.category && (
        <span className="text-[10px] uppercase tracking-wide bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
          {rule.category}
        </span>
      )}
      {isConflict && (
        <span className="cursor-help" title={conflictText}>
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        </span>
      )}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
        <button onClick={() => onEdit(rule)} className="p-1 text-muted-foreground hover:text-primary transition-colors">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} disabled={deletingRuleId === rule.id} className="p-1 text-muted-foreground hover:text-red-500 transition-colors">
          {deletingRuleId === rule.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}
