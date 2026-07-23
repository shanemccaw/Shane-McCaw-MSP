// artifacts/admin-panel/src/components/signal-rules/SignalRuleEditorModal.tsx
//
// THE rule create/edit form for the whole admin panel.
//
// This is an EXTRACTION, not a new UI. Every field, label, rule-type list,
// intelligence-field grouping, blank-handling rule and conflict-rendering
// branch below came out of SignalRules.tsx's own rule modal verbatim; that page
// now renders this component instead of its inline copy. The Simulator Studio's
// engine trace needed the same form, and the brief's instruction was to reuse
// the existing editor rather than build a second one — so the shared parts were
// lifted here and both surfaces call the same code. A forked second rule form
// would drift on exactly the details that matter (which blanks reset a field,
// which rule types carry a compareValue, how a 422 conflict is surfaced).
//
// The two call sites differ only in how the form is opened:
//   • SignalRules.tsx opens it from a rule row or a "New Rule" button.
//   • SimulatorEngineTrace.tsx opens it from a traced rule (edit) or from an
//     accepted suggestion (create, pre-filled — never silently inserted).

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ─── API shapes (match artifacts/api-server/src/routes/admin-signal-rules.ts) ──
// NOTE: licensingImpact exists in the DB but the admin API neither returns nor
// accepts it, so it is deliberately absent here.

export interface SignalIntelligenceFields {
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

export interface SignalRule extends Partial<SignalIntelligenceFields> {
  id: number;
  signalKey: string;
  groupId: number | null;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string | null;
  sortOrder: number;
}

export interface SignalGroupOption {
  id: number;
  label: string | null;
  logic: "AND" | "OR";
}

export interface RuleConflict {
  ruleIds: number[];
  description: string;
}

// ─── Rule-type metadata ───────────────────────────────────────────────────────
// The evaluator (api-server lib/tenant-signals.ts evaluateRule) recognizes
// exactly these seven types. compareValue is only read by eq/gt/lt/threshold.

export const RULE_TYPES: Array<{
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

export const ruleTypeMeta = (value: string) => RULE_TYPES.find(t => t.value === value);

// No endpoint serves these enums; values mirror SIGNAL_TREND_DIRECTIONS /
// SIGNAL_SEVERITIES in api-server lib/tenant-signals.ts.
const TREND_DIRECTIONS = ["up", "down", "flat"] as const;
const SEVERITIES = ["informational", "low", "medium", "high", "critical"] as const;

// ─── Intelligence form state (strings; blanks omitted from request bodies so
// PATCH merges against the stored row instead of clobbering it) ───────────────

export type IntelForm = Record<string, string>;

export const INTEL_NUMERIC_FIELDS = [
  "priority", "weight", "pricingImpact", "priorityScoreContribution", "pricingValueContribution",
  "governanceImpact", "securityImpact", "complianceImpact", "adoptionImpact", "copilotImpact",
  "architectureImpact", "trendValue", "decayRate", "ttlDays", "confidence",
  "crmFitContribution", "crmPainContribution", "crmMaturityContribution", "crmIntentContribution",
  "crmUrgencyContribution",
] as const;
export const INTEL_TEXT_FIELDS = ["trendDirection", "severity", "category", "pillar"] as const;
// Shown inline in the form; everything else lives under "Advanced Scoring".
const INTEL_COMMON_FIELDS = new Set(["priority", "weight", "severity"]);

export const EMPTY_INTEL: IntelForm = Object.fromEntries(
  [...INTEL_NUMERIC_FIELDS, ...INTEL_TEXT_FIELDS].map(f => [f, ""]),
);

export function intelFromRow(row: Partial<SignalIntelligenceFields>): IntelForm {
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
export function intelToBody(form: IntelForm, opts?: { blankAsDefault?: boolean }): Record<string, unknown> {
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

// ─── Rule form state ──────────────────────────────────────────────────────────

export interface RuleForm {
  signalKey: string;
  groupId: string; // "" = ungrouped
  ruleType: string;
  sourceKey: string;
  compareValue: string;
  description: string;
  sortOrder: string;
  intel: IntelForm;
}

export const emptyRuleForm = (signalKey = ""): RuleForm => ({
  signalKey,
  groupId: "",
  ruleType: "profile_key_truthy",
  sourceKey: "",
  compareValue: "",
  description: "",
  sortOrder: "0",
  intel: { ...EMPTY_INTEL },
});

/** Builds the edit-form state for an existing rule row. */
export const ruleFormFromRule = (rule: SignalRule): RuleForm => ({
  signalKey: rule.signalKey,
  groupId: rule.groupId != null ? String(rule.groupId) : "",
  ruleType: rule.ruleType,
  sourceKey: rule.sourceKey,
  compareValue: rule.compareValue ?? "",
  description: rule.description ?? "",
  sortOrder: String(rule.sortOrder),
  intel: intelFromRow(rule),
});

/**
 * The exact request body both call sites send. Shared so an edit made from the
 * engine trace writes the same shape as an edit made from the Signal Rules page.
 */
export function ruleFormToBody(form: RuleForm, isEdit: boolean): Record<string, unknown> {
  const meta = ruleTypeMeta(form.ruleType);
  return {
    signalKey: form.signalKey,
    ruleType: form.ruleType,
    sourceKey: form.sourceKey.trim(),
    // For unrecognized rule types (e.g. seeded example:* rows) the key is
    // omitted entirely: PATCH preserves the stored compareValue when the key
    // is absent, and nulling it here would silently destroy it.
    ...(meta ? { compareValue: meta.compare ? form.compareValue.trim() || null : null } : {}),
    description: form.description.trim() || null,
    groupId: form.groupId ? Number(form.groupId) : null,
    sortOrder: Number(form.sortOrder) || 0,
    ...intelToBody(form.intel, { blankAsDefault: isEdit }),
  };
}

const inputCls =
  "w-full border border-border bg-background text-foreground rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60";
const selectCls = inputCls;
const btnPrimaryCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors";
const btnGhostCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-xs font-semibold rounded-lg border border-border hover:border-primary/40 disabled:opacity-40 transition-colors";

// ─── The shared modal ─────────────────────────────────────────────────────────

export function SignalRuleEditorModal({
  open,
  form,
  onFormChange,
  editingRule,
  signalKeys,
  groupOptions,
  saving,
  error,
  conflicts,
  onSave,
  onClose,
  /** Optional banner explaining where this draft came from (e.g. an accepted suggestion). */
  contextNote,
  /** Lets the trace surface offer a free-text signal key for a brand-new signal. */
  allowFreeTextSignalKey = false,
}: {
  open: boolean;
  form: RuleForm;
  onFormChange: (updater: (prev: RuleForm) => RuleForm) => void;
  editingRule: SignalRule | null;
  signalKeys: string[];
  groupOptions: SignalGroupOption[];
  saving: boolean;
  error: string | null;
  conflicts: RuleConflict[] | null;
  onSave: () => void;
  onClose: () => void;
  contextNote?: string;
  allowFreeTextSignalKey?: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Collapse Advanced Scoring each time the modal is (re)opened, matching the
  // original page's setAdvancedOpen(false) on every open.
  useEffect(() => {
    if (open) setAdvancedOpen(false);
  }, [open]);

  if (!open) return null;

  const currentRuleTypeMeta = ruleTypeMeta(form.ruleType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !saving && onClose()}>
      <div
        className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-foreground mb-4">
          {editingRule ? "Edit Rule" : "New Rule"}
        </h2>

        {contextNote && (
          <div className="mb-4 rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs text-foreground/90">
            {contextNote}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Signal</label>
            {allowFreeTextSignalKey && !editingRule ? (
              <input
                className={inputCls}
                value={form.signalKey}
                list="signal-rule-editor-signal-keys"
                placeholder="e.g. security:mfa-gap"
                onChange={e => onFormChange(f => ({ ...f, signalKey: e.target.value, groupId: "" }))}
              />
            ) : (
              <select
                className={selectCls}
                value={form.signalKey}
                disabled={!!editingRule}
                onChange={e => onFormChange(f => ({ ...f, signalKey: e.target.value, groupId: "" }))}
              >
                <option value="">Select a signal…</option>
                {signalKeys.map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            )}
            <datalist id="signal-rule-editor-signal-keys">
              {signalKeys.map(k => (
                <option key={k} value={k} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Rule group</label>
            <select
              className={selectCls}
              value={form.groupId}
              onChange={e => onFormChange(f => ({ ...f, groupId: e.target.value }))}
            >
              <option value="">Ungrouped</option>
              {groupOptions.map(g => (
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
              value={form.ruleType}
              onChange={e => onFormChange(f => ({ ...f, ruleType: e.target.value }))}
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
              value={form.sourceKey}
              onChange={e => onFormChange(f => ({ ...f, sourceKey: e.target.value }))}
              placeholder={form.ruleType === "findings_keyword" ? "e.g. legacy auth" : "e.g. securityDefaults.isEnabled"}
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
                value={form.compareValue}
                onChange={e => onFormChange(f => ({ ...f, compareValue: e.target.value }))}
              />
            </div>
          )}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Sort order</label>
            <input
              type="number"
              className={inputCls}
              value={form.sortOrder}
              onChange={e => onFormChange(f => ({ ...f, sortOrder: e.target.value }))}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Description</label>
            <input
              className={inputCls}
              value={form.description}
              onChange={e => onFormChange(f => ({ ...f, description: e.target.value }))}
              placeholder="Why this rule exists"
            />
          </div>

          {/* Common intelligence fields, inline */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Priority</label>
            <input
              type="number"
              className={inputCls}
              value={form.intel.priority}
              placeholder="0"
              onChange={e => onFormChange(f => ({ ...f, intel: { ...f.intel, priority: e.target.value } }))}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Weight</label>
            <input
              type="number"
              className={inputCls}
              value={form.intel.weight}
              placeholder="0"
              onChange={e => onFormChange(f => ({ ...f, intel: { ...f.intel, weight: e.target.value } }))}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Severity</label>
            <select
              className={selectCls}
              value={form.intel.severity}
              onChange={e => onFormChange(f => ({ ...f, intel: { ...f.intel, severity: e.target.value } }))}
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
                    value={form.intel[f]}
                    placeholder="0"
                    onChange={e => onFormChange(prev => ({ ...prev, intel: { ...prev.intel, [f]: e.target.value } }))}
                  />
                </div>
              ))}
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">trendDirection</label>
                <select
                  className={selectCls}
                  value={form.intel.trendDirection}
                  onChange={e => onFormChange(prev => ({ ...prev, intel: { ...prev.intel, trendDirection: e.target.value } }))}
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
                  value={form.intel.category}
                  onChange={e => onFormChange(prev => ({ ...prev, intel: { ...prev.intel, category: e.target.value } }))}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">pillar</label>
                <input
                  className={inputCls}
                  value={form.intel.pillar}
                  onChange={e => onFormChange(prev => ({ ...prev, intel: { ...prev.intel, pillar: e.target.value } }))}
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {(error || (conflicts && conflicts.length > 0)) && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            <div className="flex items-center gap-2 font-semibold mb-1">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error ?? "Save rejected due to rule conflicts"}
            </div>
            {conflicts && conflicts.length > 0 && (
              <ul className="list-disc pl-5 space-y-0.5">
                {conflicts.map((c, i) => (
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
          <button onClick={onClose} disabled={saving} className={btnGhostCls}>
            Cancel
          </button>
          <button onClick={onSave} disabled={saving} className={btnPrimaryCls}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editingRule ? "Save Changes" : "Create Rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SignalRuleEditorModal;
