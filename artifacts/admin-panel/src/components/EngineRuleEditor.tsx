import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "wouter";
import { Plus, Trash2, Pencil, AlertTriangle, Loader2, Zap, ZapOff, ExternalLink, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { simulatorStudioCheckPath } from "./simulatorDeepLink";

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
  severity: "informational" | "low" | "medium" | "high" | "critical";
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
  // #511, locked path only: how GET /api/admin/signal-rules/for-check matched
  // this rule to the endpoint. "sourceKey" means the rule READS this check but
  // is NAMED under a different signal key — which is exactly what the panel has
  // to say out loud (see ForeignSignalTag). Absent on the non-locked path, whose
  // data source doesn't answer this question.
  matchedVia?: "signalKey" | "sourceKey";
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

// `threshold` IS a compare-value rule. evaluateRule (api-server
// lib/tenant-signals.ts) reads `profile[sourceKey + "__itemCount"] > Number(compareValue ?? 0)`
// — the same shape as profile_key_gt, just against the synthetic per-check item
// count. Omitting it here would post `compareValue: null` for every threshold
// rule (see handleAddRule/handleSaveEditRule, which null the field whenever
// needsCompare is false), silently rewriting an existing "item count above 10"
// rule to "above 0" the first time anyone opened it in this editor. This matches
// the canonical rule-type table in components/signal-rules/signalRuleForm.ts,
// whose own comment records the same four compare-reading types.
function needsCompare(ruleType: string) {
  return ["profile_key_eq", "profile_key_gt", "profile_key_lt", "threshold"].includes(ruleType);
}

/** The source key means something different per rule type — label it honestly. */
function sourceKeyLabel(ruleType: string) {
  if (ruleType === "findings_keyword") return "Keyword";
  if (ruleType === "threshold") return "Check Key";
  return "Profile Key";
}

/** threshold's compare value is an item count, not a generic comparand. */
function compareLabel(ruleType: string) {
  return ruleType === "threshold" ? "Item Count Above" : "Compare Value";
}

const RULE_TYPES = [
  { value: "profile_key_truthy", label: "Is Truthy",    color: "bg-green-900/40 text-green-400" },
  { value: "profile_key_falsy",  label: "Is Falsy",     color: "bg-red-900/40 text-red-400" },
  { value: "profile_key_eq",     label: "Equals",       color: "bg-blue-900/40 text-blue-400" },
  { value: "profile_key_gt",     label: "Greater Than", color: "bg-purple-900/40 text-purple-400" },
  { value: "profile_key_lt",     label: "Less Than",    color: "bg-yellow-900/40 text-yellow-400" },
  { value: "threshold",          label: "Item Count Above", color: "bg-orange-900/40 text-orange-400" },
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

/**
 * #511: names the signal a rule/group actually lives under, when that isn't the
 * endpoint's own key. Shown only on the locked (Endpoint Rules) path, where the
 * panel is scoped to a monitor check rather than to a signal — a rule matched by
 * what it READS (`sourceKey`) can be NAMED anything, and an operator editing it
 * here needs to know that or the mismatch reads as a bug (it was reported as one).
 */
function ForeignSignalTag({ signalKey }: { signalKey: string }) {
  return (
    <span
      className="text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20 px-1.5 py-0.5 rounded-full flex-shrink-0 font-mono max-w-56 truncate"
      title={`This rule reads this endpoint but is defined under the signal "${signalKey}"`}
    >
      from {signalKey}
    </span>
  );
}

// ─── Live evaluability feedback (#509) ────────────────────────────────────────
// Answers "will a real monitor check ever produce this sourceKey" while the
// operator is still typing it, instead of making them discover it later in the
// Pillar Matrix trace. The decision is made SERVER-side by
// GET /api/admin/signal-rules/check-fed, which calls the very same
// `computeRuleFedStatus` (→ buildProducibleProfileKeys + ruleIsFedByPackage +
// resolveOwningCheckKey) the Pillar Matrix's `fed` column uses — so the two
// surfaces can't drift, and the ~200-check mapping/properties catalog never has
// to be shipped to the browser for what is a yes/no answer.
//
// Advisory only: nothing here blocks saving. A rule is legitimately allowed to
// exist ahead of the check that will feed it (either half of the pair can be
// built first).

type FedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "fed"; owningCheckKey: string | null }
  | { status: "unfed" }
  | { status: "error" };

const FED_DEBOUNCE_MS = 400;

function useCheckFed(ruleType: string, sourceKey: string, enabled: boolean): FedState {
  const { fetchWithAuth } = useAuth();
  const [state, setState] = useState<FedState>({ status: "idle" });
  // fetchWithAuth identity is not guaranteed stable across renders; holding it
  // in a ref keeps it out of the effect deps so typing (not re-rendering) is
  // what re-triggers the lookup.
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  const trimmed = sourceKey.trim();

  useEffect(() => {
    if (!enabled || !trimmed) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetchRef.current(
            `/api/admin/signal-rules/check-fed?ruleType=${encodeURIComponent(ruleType)}&sourceKey=${encodeURIComponent(trimmed)}`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          if (!res.ok) { setState({ status: "error" }); return; }
          const d = await res.json() as { fed: boolean; owningCheckKey: string | null };
          if (controller.signal.aborted) return;
          setState(d.fed ? { status: "fed", owningCheckKey: d.owningCheckKey } : { status: "unfed" });
        } catch {
          // An aborted in-flight request lands here too — it has been superseded
          // by a newer keystroke, so leave the newer effect run to set state.
          if (!controller.signal.aborted) setState({ status: "error" });
        }
      })();
    }, FED_DEBOUNCE_MS);

    // Cancels BOTH a not-yet-fired debounce and an already-in-flight request, so
    // a stale response can never overwrite a newer key's verdict.
    return () => { clearTimeout(timer); controller.abort(); };
  }, [ruleType, trimmed, enabled]);

  return state;
}

/** Matches the Pillar Matrix's fed/inert visual language (SimulatorPillarMatrixCanvas.tsx). */
function EvaluabilityHint({ state }: { state: FedState }) {
  if (state.status === "idle" || state.status === "error") return null;
  if (state.status === "loading") {
    return (
      <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/60">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> checking…
      </p>
    );
  }
  if (state.status === "fed") {
    return (
      <p
        className="mt-1 flex items-center gap-1 text-[10px] text-emerald-400"
        title="A real monitor check can produce this rule's source key"
      >
        <Zap className="h-2.5 w-2.5 shrink-0" />
        {state.owningCheckKey
          ? <>Fed by <code className="font-mono">{state.owningCheckKey}</code></>
          // resolveOwningCheckKey deliberately returns null rather than guessing
          // for a keyword matching several checks, or the license-gap flags any
          // Graph check can stamp — still genuinely fed, just not by ONE check.
          : <>Fed by a real check</>}
      </p>
    );
  }
  return (
    <p
      className="mt-1 flex items-center gap-1 text-[10px] text-amber-400/80"
      title="No monitor check can currently produce this source key — a rule on it would never fire. Saving is still allowed: the check may not exist yet."
    >
      <ZapOff className="h-2.5 w-2.5 shrink-0" /> Not evaluable yet — no check currently produces this key
    </p>
  );
}

// ─── Simulator Studio pointer (#510) ──────────────────────────────────────────
// The non-locked signal picker path (used by the 7 /delivery/engines/:engineKey
// pages) can select a signal key that also happens to be a real monitor check
// key — an endpoint. Simulator Studio's Endpoint Rules tab (#507) now owns full
// CRUD for those, so this is a pointer, not a replacement: the edit form below
// stays fully usable, since some operators still land here first out of habit.

function useIsMonitorCheck(signalKey: string | null, enabled: boolean): boolean {
  const { fetchWithAuth } = useAuth();
  const [isMonitorCheck, setIsMonitorCheck] = useState(false);
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  useEffect(() => {
    if (!enabled || !signalKey) {
      setIsMonitorCheck(false);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetchRef.current(
          `/api/admin/signal-rules/is-monitor-check?key=${encodeURIComponent(signalKey)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (!res.ok) { setIsMonitorCheck(false); return; }
        const d = await res.json() as { isMonitorCheck: boolean };
        if (!controller.signal.aborted) setIsMonitorCheck(!!d.isMonitorCheck);
      } catch {
        if (!controller.signal.aborted) setIsMonitorCheck(false);
      }
    })();
    return () => controller.abort();
  }, [signalKey, enabled]);

  return isMonitorCheck;
}

// Dismissed banners persist for the tab's lifetime (sessionStorage), keyed per
// signal so dismissing one endpoint's pointer doesn't hide another's.
const SIMULATOR_BANNER_DISMISSED_KEY = "engineRuleEditor.simulatorBannerDismissed";

function isBannerDismissed(signalKey: string): boolean {
  try {
    const raw = sessionStorage.getItem(SIMULATOR_BANNER_DISMISSED_KEY);
    const dismissed: string[] = raw ? JSON.parse(raw) : [];
    return dismissed.includes(signalKey);
  } catch { return false; }
}

function dismissBanner(signalKey: string) {
  try {
    const raw = sessionStorage.getItem(SIMULATOR_BANNER_DISMISSED_KEY);
    const dismissed: string[] = raw ? JSON.parse(raw) : [];
    if (!dismissed.includes(signalKey)) {
      sessionStorage.setItem(SIMULATOR_BANNER_DISMISSED_KEY, JSON.stringify([...dismissed, signalKey]));
    }
  } catch { /* sessionStorage unavailable — banner just won't stay dismissed */ }
}

function SimulatorStudioPointerBanner({ signalKey }: { signalKey: string }) {
  const [dismissed, setDismissed] = useState(() => isBannerDismissed(signalKey));
  if (dismissed) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
      <ExternalLink className="w-3.5 h-3.5 text-primary flex-shrink-0" />
      <p className="text-xs text-foreground/80 flex-1">
        This is a real M365 Endpoint —{" "}
        <Link href={simulatorStudioCheckPath(signalKey)} className="text-primary font-semibold hover:text-primary">
          manage it in Simulator Studio →
        </Link>
      </p>
      <button
        onClick={() => { dismissBanner(signalKey); setDismissed(true); }}
        className="text-muted-foreground/60 hover:text-foreground/90 transition-colors flex-shrink-0"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── IntelligenceFieldsPanel ──────────────────────────────────────────────────

/**
 * One collapsible group inside the panel. Same disclosure-triangle affordance as
 * the outer "Show intelligence fields" toggle, nested a level in.
 */
function IntelSection({ title, count, defaultOpen, children }: {
  title: string; count: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/60 transition-colors hover:text-foreground/90 mb-1"
      >
        <span>{open ? "▲" : "▼"}</span>
        <span>{title}</span>
        <span className="text-muted-foreground/40 normal-case tracking-normal">({count})</span>
      </button>
      {open && <div className="grid grid-cols-3 gap-2">{children}</div>}
    </div>
  );
}

// #509 groups these 24 fields into four independently-collapsible sections. Every
// field keeps its exact input type, validation attributes and change handler —
// this is a layout change only, nothing about the data model or the request body
// (`intelToBody`) moved. NOTE: `licensingImpact` is a real column the API both
// returns and accepts, but it has never been part of THIS form's IntelFormFields
// and adding it would be a data-model change, so Pillar Impacts deliberately
// carries the six pillars the form actually has.
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
      {/* Expanded by default — from an endpoint-locked context most edits only
          ever touch these. */}
      <IntelSection title="Pillar Impacts" count={6} defaultOpen>
        {num("governanceImpact", "Governance")}
        {num("securityImpact", "Security")}
        {num("complianceImpact", "Compliance")}
        {num("adoptionImpact", "Adoption")}
        {num("copilotImpact", "Copilot")}
        {num("architectureImpact", "Architecture")}
      </IntelSection>

      <IntelSection title="Pricing & CRM" count={8}>
        {num("pricingImpact", "Pricing")}
        {num("priorityScoreContribution", "Priority score")}
        {num("pricingValueContribution", "Pricing value")}
        {num("crmFitContribution", "CRM Fit")}
        {num("crmPainContribution", "CRM Pain")}
        {num("crmMaturityContribution", "CRM Maturity")}
        {num("crmIntentContribution", "CRM Intent")}
        {num("crmUrgencyContribution", "CRM Urgency")}
      </IntelSection>

      <IntelSection title="Trend & Decay" count={4}>
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
      </IntelSection>

      <IntelSection title="Priority & Severity" count={6}>
        {num("priority", "Priority")}
        {num("weight", "Weight")}
        {num("confidence", "Confidence")}
        <div>
          <label className={lbl}>Severity</label>
          <select value={value.severity} onChange={e => set("severity", e.target.value)} className={sel}>
            <option value="">— low —</option>
            <option value="informational">informational</option>
            <option value="low">low</option><option value="medium">medium</option>
            <option value="high">high</option><option value="critical">critical</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Category</label>
          <input value={value.category} onChange={e => set("category", e.target.value)} placeholder="e.g. pricing:general" className={cls} />
        </div>
        <div>
          <label className={lbl}>Pillar</label>
          <input value={value.pillar} onChange={e => set("pillar", e.target.value)} placeholder="e.g. licensing" className={cls} />
        </div>
      </IntelSection>
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
  // Only the row actually being edited looks up evaluability — a collapsed row
  // would otherwise fire a request per rule on every render.
  const fedState = useCheckFed(editRuleForm.ruleType, editRuleForm.sourceKey, isEditing);

  if (isEditing) {
    return (
      <div className="px-4 py-3 bg-accent space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select value={editRuleForm.ruleType} onChange={e => setEditRuleForm(f => ({ ...f, ruleType: e.target.value }))}
            className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs">
            {RULE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div>
            <input value={editRuleForm.sourceKey} onChange={e => setEditRuleForm(f => ({ ...f, sourceKey: e.target.value }))}
              className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs font-mono w-full"
              placeholder={sourceKeyLabel(editRuleForm.ruleType)} />
            <EvaluabilityHint state={fedState} />
          </div>
        </div>
        {needsCompare(editRuleForm.ruleType) && (
          <input value={editRuleForm.compareValue} onChange={e => setEditRuleForm(f => ({ ...f, compareValue: e.target.value }))}
            className="border border-border bg-background text-foreground/90 rounded px-2 py-1 text-xs font-mono w-32"
            placeholder={compareLabel(editRuleForm.ruleType)} />
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
      {/* Only "sourceKey" matches need explaining — "signalKey" means the rule's
          own name already equals the endpoint key. */}
      {rule.matchedVia === "sourceKey" && <ForeignSignalTag signalKey={rule.signalKey} />}
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
  // #507: when set, the editor is pre-scoped to this one signal — no signal
  // list/picker, no "new signal key" flow — and its rules/groups come from
  // GET /api/admin/signal-rules `bySignal[lockedSignalKey]` instead of the
  // engineKey-scoped configuration endpoint (an endpoint's signal may not
  // belong to any engine's configuration payload). When absent, behavior is
  // identical to before the prop existed.
  lockedSignalKey?: string;
}

export default function EngineRuleEditor({ engineKey, categoryPrefix, engineLabel, importRevision, lockedSignalKey }: EngineRuleEditorProps) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [rules, setRules] = useState<SignalRule[]>([]);
  const [groups, setGroups] = useState<SignalGroup[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedSignal, setSelectedSignal] = useState<string | null>(lockedSignalKey ?? null);
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
  const addFedState = useCheckFed(addRuleForm.ruleType, addRuleForm.sourceKey, true);

  // ── Load ────────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, conflictsRes] = await Promise.all([
        fetchWithAuth(lockedSignalKey
          // #511: `bySignal[lockedSignalKey]` (#507's original lookup) only ever
          // found rules NAMED after the check. This endpoint returns the union of
          // those and the rules that READ it via sourceKey, which the Engine Trace
          // has always resolved correctly — the server does the matching, using the
          // same `computeRuleFedStatus` resolution, so nothing is filtered here.
          ? `/api/admin/signal-rules/for-check?checkKey=${encodeURIComponent(lockedSignalKey)}`
          : `/api/admin/engines/${engineKey}/configuration`),
        fetchWithAuth("/api/admin/signal-rules/conflicts"),
      ]);
      if (configRes.ok) {
        // Both endpoints return the same `{ rules, groups }` shape — since #511
        // the locked path no longer has to dig a signal out of `bySignal`, so
        // there is one parse rather than two. Only `/for-check`'s rules carry
        // `matchedVia`; it is optional and simply absent on the other.
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
  }, [engineKey, lockedSignalKey, fetchWithAuth, toast]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => { if (importRevision) void loadData(); }, [importRevision, loadData]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const signalKeys = useMemo(() => {
    const keys = new Set([...groups.map(g => g.signalKey), ...rules.map(r => r.signalKey)]);
    return [...keys].sort();
  }, [groups, rules]);

  // #511: on the LOCKED path the server already returned exactly this endpoint's
  // rules/groups (`/for-check`), and a legitimately-matched rule can carry a
  // signalKey that differs from the check key — filtering by `selectedSignal`
  // here would throw away the very rows the fix exists to surface. The
  // non-locked (signal-picker) path keeps its filter untouched: there, `rules`
  // is the whole engine's set and `selectedSignal` is the only thing scoping it.
  const selectedGroups = useMemo(
    () => (lockedSignalKey ? groups : groups.filter(g => g.signalKey === selectedSignal)),
    [groups, selectedSignal, lockedSignalKey],
  );
  const selectedRules = useMemo(
    () => (lockedSignalKey ? rules : rules.filter(r => r.signalKey === selectedSignal)),
    [rules, selectedSignal, lockedSignalKey],
  );
  const conflictRuleIds = useMemo(() => new Set(conflicts.flatMap(c => c.ruleIds)), [conflicts]);

  // Groups a NEW rule may be assigned to. `computeTenantSignals` collects a
  // group's rules by groupId alone but only ever evaluates the group under the
  // group's OWN signalKey, so dropping a rule created under signal A into a
  // group owned by signal B silently makes it contribute to B instead. Since
  // #511 the locked path can now legitimately DISPLAY foreign-signal groups
  // (pulled in because their rules read this endpoint) — displaying them is the
  // point, offering them as targets for a rule created under the check's own key
  // is not. No-op on the non-locked path, where every selectedGroup already has
  // signalKey === selectedSignal.
  const assignableGroups = useMemo(
    () => selectedGroups.filter(g => g.signalKey === selectedSignal),
    [selectedGroups, selectedSignal],
  );

  // #510: only the non-locked signal-picker path needs the Simulator Studio
  // pointer — a locked signal IS already Simulator Studio itself.
  const isMonitorCheckSignal = useIsMonitorCheck(selectedSignal, !lockedSignalKey);

  // A locked signal IS the selection — track prop changes directly.
  useEffect(() => {
    if (lockedSignalKey) setSelectedSignal(lockedSignalKey);
  }, [lockedSignalKey]);

  // Auto-select first signal when data loads
  useEffect(() => {
    if (!lockedSignalKey && !selectedSignal && signalKeys.length > 0) setSelectedSignal(signalKeys[0]);
  }, [signalKeys, selectedSignal, lockedSignalKey]);

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
      {/* ── Left: signal key list — hidden entirely when the signal is locked ── */}
      {!lockedSignalKey && (
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
      )}

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

            {!lockedSignalKey && isMonitorCheckSignal && selectedSignal && (
              <SimulatorStudioPointerBanner signalKey={selectedSignal} />
            )}

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
                      {/* #511's group equivalent: a group pulled in because one of
                          its rules reads this endpoint carries its own signal key.
                          Groups have no `matchedVia` (the server returns them
                          unannotated), so compare the key directly — the same
                          condition, since a group whose key matches needs no tag. */}
                      {lockedSignalKey && group.signalKey !== lockedSignalKey && (
                        <ForeignSignalTag signalKey={group.signalKey} />
                      )}
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
                    {sourceKeyLabel(addRuleForm.ruleType)}
                  </label>
                  <input value={addRuleForm.sourceKey} onChange={e => setAddRuleForm(f => ({ ...f, sourceKey: e.target.value }))}
                    placeholder={addRuleForm.ruleType === "threshold" ? "e.g. identity:ca-policy-count" : "e.g. mfaEnforced"}
                    className={inputCls} />
                  <EvaluabilityHint state={addFedState} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {needsCompare(addRuleForm.ruleType) && (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">{compareLabel(addRuleForm.ruleType)}</label>
                    <input value={addRuleForm.compareValue} onChange={e => setAddRuleForm(f => ({ ...f, compareValue: e.target.value }))}
                      placeholder="e.g. 60" className={inputCls} />
                  </div>
                )}
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Group (optional)</label>
                  <select value={addRuleForm.groupId} onChange={e => setAddRuleForm(f => ({ ...f, groupId: e.target.value }))}
                    className="w-full border border-border bg-background text-foreground/90 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                    <option value="">— Ungrouped —</option>
                    {assignableGroups.map(g => (
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
