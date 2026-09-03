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
// The PURE (React-free) half of that shared code — types, the rule-type table,
// the intelligence-field helpers, the request-body builders, the validator, and
// the trace "add rule" draft helpers — lives in ./signalRuleForm so it can be
// unit-tested (this project's vitest is node-env / .test.ts only). This file
// re-exports all of it, so importers of "./SignalRuleEditorModal" are unchanged.
//
// The two call sites differ only in how the form is opened:
//   • SignalRules.tsx opens it from a rule row or a "New Rule" button.
//   • SimulatorEngineTrace.tsx opens it from a traced rule (edit), from an
//     accepted suggestion (create, pre-filled), or from the per-property
//     "Add rule" action (create, pre-filled) — never silently inserted.

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Trash2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import {
  RULE_TYPES,
  ruleTypeMeta,
  INTEL_NUMERIC_FIELDS,
  TREND_DIRECTIONS,
  SEVERITIES,
  NEW_SIGNAL_OPTION,
  NEW_GROUP_OPTION,
  type RuleForm,
  type SignalRule,
  type SignalGroupOption,
  type RuleConflict,
} from "./signalRuleForm";

// Re-export the whole pure layer so existing importers of this module keep
// working (emptyRuleForm, ruleFormFromRule, ruleFormToBody, validateRuleForm,
// the types, RULE_TYPES, etc.). New code may prefer importing ./signalRuleForm
// directly.
export * from "./signalRuleForm";

// Shown inline in the form; everything else lives under "Advanced Scoring".
const INTEL_COMMON_FIELDS = new Set(["priority", "weight", "severity"]);

const inputCls =
  "w-full border border-border bg-background text-foreground rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60";
const selectCls = inputCls;
const btnPrimaryCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors";
const btnGhostCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-xs font-semibold rounded-lg border border-border hover:border-primary/40 disabled:opacity-40 transition-colors";
const btnDangerCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-transparent text-red-400 text-xs font-semibold rounded-lg border border-red-500/40 hover:bg-red-500/10 disabled:opacity-40 transition-colors mr-auto";

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
  /**
   * When provided (and editingRule is set), shows a destructive "Delete rule"
   * button. The modal itself gathers an explicit confirmation (window.confirm,
   * matching the discipline the Signal Rules page's own row-delete button
   * already uses) before invoking this — callers can assume onDelete only
   * fires once the operator has confirmed.
   */
  onDelete,
  deleting = false,
  /** Optional banner explaining where this draft came from (e.g. an accepted suggestion). */
  contextNote,
  /**
   * Lets this surface create a brand-new catalogued signal inline (an extra
   * "➕ Create a new signal…" choice that reveals key/label/description fields).
   * Replaces the old free-text-key input, which let an operator type an
   * arbitrary key and silently create a rule orphaned from real scoring. When
   * false, only existing catalogued signals can be picked (the Signal Rules
   * page's dropdown-only behaviour, unchanged).
   */
  allowNewSignalCreation = false,
  /**
   * Lets this surface create a brand-new rule GROUP inline (an extra "➕ New
   * group (OR / AND)…" choice in the Rule group dropdown that reveals an OR/AND
   * selector + optional label). The group is created via the SAME existing
   * POST /api/admin/signal-rule-groups endpoint the Signal Rules page uses — the
   * save handler creates it first, then attaches the rule. This is what lets an
   * operator build a multi-rule OR-group directly while adding a second rule to
   * a property from the trace. The Signal Rules page has its own dedicated group
   * modal, so it leaves this false.
   */
  allowNewGroupCreation = false,
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
  onDelete?: () => void;
  deleting?: boolean;
  contextNote?: string;
  allowNewSignalCreation?: boolean;
  allowNewGroupCreation?: boolean;
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
            {/*
              Create: a dropdown of REAL catalogued signals, plus (only where
              allowNewSignalCreation is set) an explicit "create a new signal"
              choice that reveals the label/description fields below. There is no
              free-text-key path any more — an arbitrary key produced an orphan
              rule invisible to real scoring. Edit: the signal is fixed.
            */}
            <select
              className={selectCls}
              value={form.createNewSignal ? NEW_SIGNAL_OPTION : form.signalKey}
              disabled={!!editingRule}
              onChange={e => {
                const v = e.target.value;
                if (v === NEW_SIGNAL_OPTION) {
                  onFormChange(f => ({ ...f, createNewSignal: true, signalKey: "", groupId: "", createNewGroup: false }));
                } else {
                  onFormChange(f => ({ ...f, createNewSignal: false, signalKey: v, groupId: "", createNewGroup: false }));
                }
              }}
            >
              <option value="">Select a signal…</option>
              {signalKeys.map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
              {allowNewSignalCreation && !editingRule && (
                <option value={NEW_SIGNAL_OPTION}>➕ Create a new signal…</option>
              )}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Rule group</label>
            <select
              className={selectCls}
              value={form.createNewGroup ? NEW_GROUP_OPTION : form.groupId}
              onChange={e => {
                const v = e.target.value;
                if (v === NEW_GROUP_OPTION) {
                  onFormChange(f => ({ ...f, createNewGroup: true, groupId: "" }));
                } else {
                  onFormChange(f => ({ ...f, createNewGroup: false, groupId: v }));
                }
              }}
            >
              <option value="">Ungrouped</option>
              {groupOptions.map(g => (
                <option key={g.id} value={String(g.id)}>
                  {g.label ?? `Group #${g.id}`} ({g.logic})
                </option>
              ))}
              {allowNewGroupCreation && !editingRule && (
                <option value={NEW_GROUP_OPTION}>➕ New group (OR / AND)…</option>
              )}
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
          {currentRuleTypeMeta?.denominator && (
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                {currentRuleTypeMeta.denominator.label}
                <span className="ml-1 text-muted-foreground/60">({currentRuleTypeMeta.denominator.hint})</span>
              </label>
              <input
                className={inputCls}
                value={form.denominatorKey}
                onChange={e => onFormChange(f => ({ ...f, denominatorKey: e.target.value }))}
                placeholder="e.g. totalUserCount"
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

          {/* New-signal registration — shown only when the operator chose to
              create a new signal. The rule and this catalog entry are created
              together server-side (one transaction); a rule can never be saved
              against a bare key with no real signal behind it. */}
          {form.createNewSignal && !editingRule && (
            <div className="col-span-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="mb-2 text-[11px] font-semibold text-foreground/90">
                New signal — registered in the catalog alongside this rule so it actually affects real scoring
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Signal key</label>
                  <input
                    className={inputCls}
                    value={form.signalKey}
                    placeholder="e.g. signal.security.mfa-gap"
                    onChange={e => onFormChange(f => ({ ...f, signalKey: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Label</label>
                  <input
                    className={inputCls}
                    value={form.newSignalLabel}
                    placeholder="e.g. MFA enforcement gap"
                    onChange={e => onFormChange(f => ({ ...f, newSignalLabel: e.target.value }))}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Description</label>
                  <input
                    className={inputCls}
                    value={form.newSignalDescription}
                    placeholder="What this signal means and why it matters"
                    onChange={e => onFormChange(f => ({ ...f, newSignalDescription: e.target.value }))}
                  />
                </div>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                Label and description are required — they make this a real, properly-catalogued signal rather than a bare key.
              </p>
            </div>
          )}

          {/* New-group creation — shown only when the operator chose "New group"
              in the Rule group dropdown. Saving creates this group first (via the
              same POST /api/admin/signal-rule-groups endpoint the Signal Rules
              page uses), then attaches the rule to it — the natural way to start
              a multi-rule OR-group while adding a rule to a property. */}
          {form.createNewGroup && !editingRule && (
            <div className="col-span-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="mb-2 text-[11px] font-semibold text-foreground/90">
                New rule group — this rule, plus any others you later attach to it, fire the signal together by the logic below
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Logic</label>
                  <select
                    className={selectCls}
                    value={form.newGroupLogic}
                    onChange={e => onFormChange(f => ({ ...f, newGroupLogic: e.target.value as "AND" | "OR" }))}
                  >
                    <option value="OR">OR — any member rule fires the signal</option>
                    <option value="AND">AND — every member rule must pass</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Group label</label>
                  <input
                    className={inputCls}
                    value={form.newGroupLabel}
                    placeholder="Optional (e.g. MFA gap conditions)"
                    onChange={e => onFormChange(f => ({ ...f, newGroupLabel: e.target.value }))}
                  />
                </div>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                Creating the rule will create this group first, then attach the rule — reusing the same group endpoint as the Signal Rules page.
              </p>
            </div>
          )}

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
          {editingRule && onDelete && (
            <button
              onClick={() => {
                if (
                  confirm(
                    `Delete this ${editingRule.ruleType} rule on "${editingRule.sourceKey}"? This cannot be undone.`,
                  )
                ) {
                  onDelete();
                }
              }}
              disabled={saving || deleting}
              className={btnDangerCls}
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete rule
            </button>
          )}
          <button onClick={onClose} disabled={saving || deleting} className={btnGhostCls}>
            Cancel
          </button>
          <button onClick={onSave} disabled={saving || deleting} className={btnPrimaryCls}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editingRule ? "Save Changes" : "Create Rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SignalRuleEditorModal;
