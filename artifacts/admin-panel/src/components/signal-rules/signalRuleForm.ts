// artifacts/admin-panel/src/components/signal-rules/signalRuleForm.ts
//
// The PURE (React-free) layer of the shared rule editor. Every type, rule-type
// table, intelligence-field helper, request-body builder and validator the
// SignalRuleEditorModal needs lives here so it can be unit-tested without a DOM
// (this project's vitest runs `environment: "node"` over `src/**/*.test.ts`, so
// a component tsx can't be imported into a test). `SignalRuleEditorModal.tsx`
// re-exports everything below unchanged, so existing importers keep working.
//
// This module was extracted from SignalRuleEditorModal.tsx as part of the
// "Shore Up Rule Creation UX" work, which needed the validator, the create-form
// builders and the new trace helpers (draftRuleForTracedKey / groupCreateBody)
// under test. No behaviour of the moved code changed except validateRuleForm,
// whose messaging was corrected (see below).

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
  /** Denominator profile key for ruleType "profile_key_ratio" only (#2514). Null otherwise. */
  denominatorKey: string | null;
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
// these eight types. compareValue is only read by eq/gt/lt/threshold/ratio.
// profile_key_ratio is the only type that also reads a second field,
// denominatorKey (#2514) — see the `denominator` entry below.

export const RULE_TYPES: Array<{
  value: string;
  label: string;
  sourceKeyLabel: string;
  compare: null | { label: string; hint: string };
  denominator?: { label: string; hint: string };
}> = [
  { value: "profile_key_truthy", label: "Profile key is truthy", sourceKeyLabel: "Profile field path", compare: null },
  { value: "profile_key_falsy", label: "Profile key is falsy", sourceKeyLabel: "Profile field path", compare: null },
  { value: "profile_key_eq", label: "Profile key equals", sourceKeyLabel: "Profile field path", compare: { label: "Compare value", hint: "String equality" } },
  { value: "profile_key_gt", label: "Profile key greater than", sourceKeyLabel: "Profile field path", compare: { label: "Compare value", hint: "Numeric threshold" } },
  { value: "profile_key_lt", label: "Profile key less than", sourceKeyLabel: "Profile field path", compare: { label: "Compare value", hint: "Numeric threshold" } },
  { value: "threshold", label: "Monitor item-count threshold", sourceKeyLabel: "Monitor key", compare: { label: "Item count above", hint: "Fires when the monitor's item count exceeds this number" } },
  { value: "findings_keyword", label: "Findings keyword match", sourceKeyLabel: "Keyword", compare: null },
  {
    value: "profile_key_ratio",
    label: "Cross-check ratio (percent below)",
    sourceKeyLabel: "Numerator profile field path",
    compare: { label: "Fires below (%)", hint: "Fires when (numerator / denominator) * 100 is less than this" },
    denominator: { label: "Denominator profile field path", hint: "Read from the same merged cross-check tenant profile — can come from a different monitor check than the numerator" },
  },
];

export const ruleTypeMeta = (value: string) => RULE_TYPES.find(t => t.value === value);

// No endpoint serves these enums; values mirror SIGNAL_TREND_DIRECTIONS /
// SIGNAL_SEVERITIES in api-server lib/tenant-signals.ts.
export const TREND_DIRECTIONS = ["up", "down", "flat"] as const;
export const SEVERITIES = ["informational", "low", "medium", "high", "critical"] as const;

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
  /** Denominator profile field path — only used/shown when ruleType is "profile_key_ratio" (#2514). */
  denominatorKey: string;
  description: string;
  sortOrder: string;
  intel: IntelForm;
  // ── New-signal creation (create-only; only surfaces passing
  // allowNewSignalCreation expose the UI). When true, `signalKey` is the brand-
  // new key and newSignalLabel/newSignalDescription register its custom_signals
  // catalog row atomically with the rule. See ruleFormToBody's `newSignal`. ──
  createNewSignal: boolean;
  newSignalLabel: string;
  newSignalDescription: string;
  // ── New-group creation (create-only; only surfaces passing
  // allowNewGroupCreation expose the UI). When true, the rule is attached to a
  // brand-new signal_rule_groups row created via the SAME existing
  // POST /api/admin/signal-rule-groups endpoint the Signal Rules page uses (see
  // groupCreateBodyFromForm), with the chosen OR/AND logic. This is what lets an
  // operator build a multi-rule OR-group directly while adding a second rule to
  // a property, instead of leaving the trace to make one on the rules page. ──
  createNewGroup: boolean;
  newGroupLogic: "AND" | "OR";
  newGroupLabel: string;
}

export const emptyRuleForm = (signalKey = ""): RuleForm => ({
  signalKey,
  groupId: "",
  ruleType: "profile_key_truthy",
  sourceKey: "",
  compareValue: "",
  denominatorKey: "",
  description: "",
  sortOrder: "0",
  intel: { ...EMPTY_INTEL },
  createNewSignal: false,
  newSignalLabel: "",
  newSignalDescription: "",
  createNewGroup: false,
  newGroupLogic: "OR",
  newGroupLabel: "",
});

/** Builds the edit-form state for an existing rule row. */
export const ruleFormFromRule = (rule: SignalRule): RuleForm => ({
  signalKey: rule.signalKey,
  groupId: rule.groupId != null ? String(rule.groupId) : "",
  ruleType: rule.ruleType,
  sourceKey: rule.sourceKey,
  compareValue: rule.compareValue ?? "",
  denominatorKey: rule.denominatorKey ?? "",
  description: rule.description ?? "",
  sortOrder: String(rule.sortOrder),
  intel: intelFromRow(rule),
  createNewSignal: false,
  newSignalLabel: "",
  newSignalDescription: "",
  createNewGroup: false,
  newGroupLogic: "OR",
  newGroupLabel: "",
});

/**
 * The exact request body both call sites send. Shared so an edit made from the
 * engine trace writes the same shape as an edit made from the Signal Rules page.
 *
 * NOTE: `groupId` here reflects the CHOSEN existing group only. When the form is
 * creating a NEW group (createNewGroup), the caller creates that group first via
 * groupCreateBodyFromForm and overrides groupId on the resulting body with the
 * new group's id — this builder never invents a group id.
 */
export function ruleFormToBody(form: RuleForm, isEdit: boolean): Record<string, unknown> {
  const meta = ruleTypeMeta(form.ruleType);
  return {
    signalKey: form.signalKey.trim(),
    ruleType: form.ruleType,
    sourceKey: form.sourceKey.trim(),
    // For unrecognized rule types (e.g. seeded example:* rows) the key is
    // omitted entirely: PATCH preserves the stored compareValue when the key
    // is absent, and nulling it here would silently destroy it.
    ...(meta ? { compareValue: meta.compare ? form.compareValue.trim() || null : null } : {}),
    // Same reasoning as compareValue above — only nulled for recognized types
    // that don't carry a denominator, never for an unrecognized stored type.
    ...(meta ? { denominatorKey: meta.denominator ? form.denominatorKey.trim() || null : null } : {}),
    description: form.description.trim() || null,
    groupId: form.groupId ? Number(form.groupId) : null,
    sortOrder: Number(form.sortOrder) || 0,
    ...intelToBody(form.intel, { blankAsDefault: isEdit }),
    // Register a brand-new catalog signal alongside the rule. The server
    // creates the custom_signals row and the rule in one transaction; without
    // this the rule would be an orphan invisible to real scoring, and the
    // server rejects it. Only sent on create + when the operator chose to
    // create a new signal.
    ...(!isEdit && form.createNewSignal
      ? { newSignal: { label: form.newSignalLabel.trim(), description: form.newSignalDescription.trim() } }
      : {}),
  };
}

/**
 * The request body for creating the rule's new group via the EXISTING
 * POST /api/admin/signal-rule-groups endpoint (the same one SignalRules.tsx's
 * group modal posts to). Returned separately so the save flow can create the
 * group first and then point the rule at its id — no second group-creation
 * mechanism is introduced.
 */
export function groupCreateBodyFromForm(form: RuleForm): { signalKey: string; logic: "AND" | "OR"; label: string | null; sortOrder: number } {
  return {
    signalKey: form.signalKey.trim(),
    logic: form.newGroupLogic,
    label: form.newGroupLabel.trim() || null,
    sortOrder: 0,
  };
}

/**
 * Client-side pre-validation shared by both call sites' save handlers. Returns
 * a human error string naming the SPECIFIC missing field, or null if the form
 * may be submitted. The server enforces the same rules authoritatively (a direct
 * API call can't bypass them); this only spares the operator a round-trip.
 *
 * WHY the per-field messages (the "Shore Up Rule Creation UX" fix): the previous
 * validator collapsed three distinct states into one "Signal, rule type, and
 * source key are required." string. That misfired hardest in new-signal mode —
 * choosing "➕ Create a new signal…" in the dropdown sets createNewSignal and
 * clears `signalKey` (the key now comes from a SEPARATE text input), so an
 * operator who had visibly selected that option, and typed a label/description,
 * was told to "select a Signal" they believed they'd already selected. The
 * control showing a selection and the field the validator checked were different
 * things. Each state now gets its own accurate message pointing at the real
 * field to fill.
 */
export function validateRuleForm(form: RuleForm, isEdit: boolean): string | null {
  if (!form.ruleType) return "Choose a rule type.";
  if (!form.sourceKey.trim()) {
    const label = ruleTypeMeta(form.ruleType)?.sourceKeyLabel ?? "source key";
    return `Enter the ${label.toLowerCase()} this rule reads.`;
  }
  const denomMeta = ruleTypeMeta(form.ruleType)?.denominator;
  if (denomMeta && !form.denominatorKey.trim()) {
    return `Enter the ${denomMeta.label.toLowerCase()} this rule divides by.`;
  }
  if (!isEdit && form.createNewSignal) {
    // In new-signal mode the "Signal" control shows "➕ Create a new signal…";
    // the actual key lives in the revealed text input. Name that field, don't
    // tell the operator to re-pick a Signal they already chose to create.
    if (!form.signalKey.trim()) {
      return "Enter a key for the new signal (for example: security:mfa-gap) — this is the signal the rule attaches to.";
    }
    if (!form.newSignalLabel.trim() || !form.newSignalDescription.trim()) {
      return "The new signal needs both a label and a description so it becomes a real, scored catalog entry — not just a bare key.";
    }
    return null;
  }
  if (!form.signalKey.trim()) return "Select the signal this rule feeds.";
  return null;
}

// ─── Trace "Add rule" draft (universal per-property add) ───────────────────────

/**
 * The minimal information the engine trace holds about one produced key. Kept
 * structural (not imported from the trace component) so this stays React-free
 * and testable.
 */
export interface TracedKeyLike {
  key: string;
  origin: "mapping" | "property" | "itemCount";
}

/**
 * Builds a pre-filled draft rule for the "Add rule" action on a traced property
 * that has NO inferred suggestion to accept — i.e. the value isn't rule-readable
 * (object/array/null) or it's the synthetic item-count key, for which a
 * direction can't be guessed from a name. When a suggestion DOES exist the
 * caller reuses the existing acceptSuggestion() path instead of this; this is
 * only the fallback, and it still sets source_key to the real property so the
 * operator's "only job is the description and the actual condition".
 *
 *   • itemCount key (`<checkKey>__itemCount`): a `threshold` rule whose source
 *     key is the CHECK key itself (what threshold rules read), not the synthetic
 *     `__itemCount` name.
 *   • any other key: a `profile_key_truthy` starting point reading that key.
 *
 * signalKey is left blank on purpose — the operator picks the real signal (or
 * creates one) in the modal; the draft never guesses a signal.
 */
export function draftRuleForTracedKey(k: TracedKeyLike, checkKey: string): RuleForm {
  const form = emptyRuleForm("");
  if (k.origin === "itemCount") {
    form.ruleType = "threshold";
    form.sourceKey = checkKey;
  } else {
    form.ruleType = "profile_key_truthy";
    form.sourceKey = k.key;
  }
  return form;
}

// Sentinel values for the "create a new signal" / "create a new group" dropdown
// choices — must not collide with any real signal_key or group id string.
export const NEW_SIGNAL_OPTION = "__create_new_signal__";
export const NEW_GROUP_OPTION = "__create_new_group__";
