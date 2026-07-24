// artifacts/admin-panel/src/components/SimulatorEngineTrace.tsx
//
// The engine trace, shown alongside a completed run's response in the Simulator
// Studio's "M365 Endpoints" node (phase 2).
//
// WHAT THIS REPLACES: manually tracing, in SQL, endpoint response -> the check's
// mapping transforms -> the profile keys actually produced -> which
// signal_derivation_rules read those keys -> whether each evaluates true or
// false. The backend does that whole chain in one call, using the real
// functions (applyMapping / evaluateRule / mergeMonitorProfileRows), so what is
// rendered here is the engine's own answer rather than a second opinion about it.
//
// TWO SIMILARLY-NAMED, FUNCTIONALLY DIFFERENT ACTIONS — the UI's main job is to
// keep these unmistakable:
//
//   • RE-EVALUATE (secondary button, no spinner-on-network semantics)
//     POST /api/admin/monitor-check-runs/:runId/trace
//     Re-runs mapping + rule evaluation against the response ALREADY captured.
//     No Graph call, no new tenant traffic, near-instant. This is the tuning
//     loop: change a rule, re-evaluate, see whether the answer is now correct
//     against the SAME data.
//
//   • RE-RUN (primary-outline button, explicit warning copy)
//     POST /api/admin/monitor-checks/:key/run — the existing phase-1 route.
//     Genuinely calls the live tenant again, then traces the fresh response.
//     Slower, real network, for confirming a fix holds against fresh data.
//
// Each button states its own consequence inline ("uses the captured response" /
// "calls the live tenant") rather than relying on the operator remembering
// which is which.
//
// RULE EDITING reuses the SAME form the Signal Rules page uses
// (SignalRuleEditorModal, extracted from that page for this purpose) — edits
// PATCH the real signal_derivation_rules row and accepted suggestions POST a
// real new one. Nothing here is a sandbox: this is genuine tuning of the real
// rules. Suggestions are NEVER auto-applied — Accept only opens an editable
// draft, and the operator still has to save it.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import SignalRuleEditorModal, {
  emptyRuleForm,
  ruleFormFromRule,
  ruleFormToBody,
  type RuleConflict,
  type RuleForm,
  type SignalGroupOption,
  type SignalRule,
} from "@/components/signal-rules/SignalRuleEditorModal";

// ─── API shapes (match api-server lib/monitor-check-trace.ts) ─────────────────

interface TracedRule {
  ruleId: number;
  signalKey: string;
  groupId: number | null;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string | null;
  result: boolean;
  /** Produced by evaluateRule itself — rendered verbatim, never re-worded here. */
  reason: string;
}

interface TracedKey {
  key: string;
  value: unknown;
  origin: "mapping" | "property" | "itemCount";
  sourceField?: string;
  transform?: string;
  rules: TracedRule[];
  uncovered: boolean;
}

interface RuleSuggestion {
  sourceKey: string;
  ruleType: string;
  compareValue: string | null;
  observedValue: unknown;
  observedType: string;
  rationale: string;
  dominantPillar: string;
  pillarImpacts: Record<string, number>;
  suggestedSignalKey: string;
  severity: string;
}

interface CheckTrace {
  checkKey: string;
  keys: TracedKey[];
  suggestions: RuleSuggestion[];
  itemCount: number;
  coveredKeyCount: number;
  uncoveredKeyCount: number;
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "object") {
    const json = JSON.stringify(value);
    return json.length > 60 ? `${json.slice(0, 60)}…` : json;
  }
  return String(value);
}

export interface SimulatorEngineTraceHandle {
  /**
   * Full Response mode (Part A): traces a raw Graph field that ISN'T in the
   * check's configured `properties` yet, by re-tracing with that field added
   * to the properties list. Reuses the exact same trace route + inferSuggestion
   * pipeline every other suggestion here goes through — no second suggestion
   * engine. Opens the shared rule editor as a draft on success; toasts if the
   * property's value type isn't rule-readable (object/array/null) or there is
   * no captured run to trace yet.
   */
  suggestRuleForProperty: (propKey: string) => Promise<void>;
}

export const SimulatorEngineTrace = forwardRef<SimulatorEngineTraceHandle, {
  /** The completed run whose captured response is traced. Null when nothing has run yet. */
  runId: string | null;
  checkKey: string;
  runStatus: string | null;
  /** Triggers a genuinely new live execution via the phase-1 run route. */
  onRerun: () => void;
  rerunning: boolean;
  /** The check's own currently configured raw properties list. */
  checkProperties: string[];
}>(function SimulatorEngineTrace({ runId, checkKey, runStatus, onRerun, rerunning, checkProperties }, ref) {
  const { fetchWithAuth } = useAuth();

  const [trace, setTrace] = useState<CheckTrace | null>(null);
  const [tracing, setTracing] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [discarded, setDiscarded] = useState<Record<string, boolean>>({});

  // Signals + groups, for the shared editor's dropdowns.
  const [signalKeys, setSignalKeys] = useState<string[]>([]);
  const [groupsBySignal, setGroupsBySignal] = useState<Record<string, SignalGroupOption[]>>({});

  // Shared-editor state (same shape the Signal Rules page keeps).
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<SignalRule | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>(emptyRuleForm());
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [ruleConflicts, setRuleConflicts] = useState<RuleConflict[] | null>(null);
  const [modalNote, setModalNote] = useState<string | undefined>(undefined);

  // A trace belongs to one run; drop it when the run changes so a stale trace
  // can never be read as describing the current response.
  useEffect(() => {
    setTrace(null);
    setTraceError(null);
    setDiscarded({});
  }, [runId]);

  const loadSignalOptions = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules");
      const data = await res.json();
      if (!res.ok) return;
      const bySignal = (data.bySignal ?? {}) as Record<string, { groups?: SignalGroupOption[] }>;
      setSignalKeys(Object.keys(bySignal).sort());
      const groups: Record<string, SignalGroupOption[]> = {};
      for (const [key, val] of Object.entries(bySignal)) groups[key] = val.groups ?? [];
      setGroupsBySignal(groups);
    } catch {
      // Non-fatal: the editor still works, its signal dropdown is just empty.
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadSignalOptions();
  }, [loadSignalOptions]);

  /**
   * RE-EVALUATE — no network call to Graph, no new tenant traffic. Hits only the
   * trace route, which reads the response this run already captured.
   */
  const handleReevaluate = useCallback(async () => {
    if (!runId) return;
    setTracing(true);
    setTraceError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/monitor-check-runs/${runId}/trace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setTraceError(data.error || "Failed to trace this run");
        setTrace(null);
        return;
      }
      setTrace(data.trace as CheckTrace);
    } catch (err: any) {
      setTraceError(err.message || "Network error tracing this run");
    } finally {
      setTracing(false);
    }
  }, [fetchWithAuth, runId]);

  // Trace automatically once a run completes — the operator ran the endpoint to
  // see what it produces, so making them press a second button first is friction
  // with no informational value.
  useEffect(() => {
    if (runId && runStatus === "completed" && !trace && !tracing && !traceError) {
      void handleReevaluate();
    }
  }, [runId, runStatus, trace, tracing, traceError, handleReevaluate]);

  const openEditRule = async (traced: TracedRule) => {
    // Fetch the rule's full stored row: the trace carries only the fields it
    // needs to explain an outcome, and opening the editor on a partial row
    // would blank every intelligence field the operator didn't see.
    try {
      const res = await fetchWithAuth("/api/admin/signal-rules");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load the rule");
      const all = (data.rules ?? []) as SignalRule[];
      const full = all.find(r => r.id === traced.ruleId);
      if (!full) {
        toast.error("That rule no longer exists — re-evaluate to refresh the trace");
        return;
      }
      setEditingRule(full);
      setRuleForm(ruleFormFromRule(full));
      setModalNote(
        `Editing the real signal_derivation_rules row #${full.id}. Saving writes to the live rules table; use “Re-evaluate” afterwards to see the new result against this same captured response.`,
      );
      setRuleError(null);
      setRuleConflicts(null);
      setRuleModalOpen(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to open that rule");
    }
  };

  /**
   * ACCEPT a suggestion — opens it as an editable draft. It is NOT inserted
   * here; the operator still has to press Create Rule in the editor.
   */
  const acceptSuggestion = (s: RuleSuggestion) => {
    const form = emptyRuleForm(s.suggestedSignalKey);
    form.ruleType = s.ruleType;
    form.sourceKey = s.sourceKey;
    form.compareValue = s.compareValue ?? "";
    form.description = `Suggested from a ${checkKey} simulator run (observed ${s.observedType} value: ${formatValue(s.observedValue)}).`;
    form.intel.severity = s.severity;
    form.intel.pillar = s.dominantPillar;
    for (const [field, value] of Object.entries(s.pillarImpacts)) {
      form.intel[field] = String(value);
    }
    setEditingRule(null);
    setRuleForm(form);
    setModalNote(
      `This is a SUGGESTED rule, pre-filled from the observed response — nothing has been created yet. Review the direction and thresholds, then press “Create Rule” to insert it. Rationale: ${s.rationale}`,
    );
    setRuleError(null);
    setRuleConflicts(null);
    setRuleModalOpen(true);
  };

  const handleRuleSave = async () => {
    if (!ruleForm.signalKey || !ruleForm.ruleType || !ruleForm.sourceKey.trim()) {
      setRuleError("Signal, rule type, and source key are required.");
      return;
    }
    setRuleSaving(true);
    setRuleError(null);
    setRuleConflicts(null);
    // Identical request shape to the Signal Rules page — same shared builder.
    const body = ruleFormToBody(ruleForm, !!editingRule);
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
        setRuleConflicts((data.conflicts ?? []) as RuleConflict[]);
        setRuleError(data.error ?? "This change conflicts with existing rules and was not saved.");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to save rule");
      toast.success(editingRule ? "Rule updated — re-evaluating" : "Rule created — re-evaluating");
      setRuleModalOpen(false);
      void loadSignalOptions();
      // Re-evaluate against the SAME captured response so the effect of the edit
      // is visible immediately, with no new tenant call.
      void handleReevaluate();
    } catch (err: any) {
      setRuleError(err.message || "Failed to save rule");
    } finally {
      setRuleSaving(false);
    }
  };

  /**
   * FULL RESPONSE — suggest a rule for a raw Graph field not yet in this
   * check's `properties`. Re-traces with that field appended (server applies
   * the SAME applyMapping raw-property extraction as every other property:
   * `${propKey}_count` / `${propKey}_first` / `${propKey}_values`), then
   * accepts whichever produced suggestion actually reads it — `_first` first,
   * since that carries the field's real observed value/type, falling back to
   * `_count` if `_first` was null on every item.
   */
  const suggestRuleForProperty = useCallback(
    async (propKey: string) => {
      if (!runId) {
        toast.error("Run this endpoint first — there's no captured response to trace yet.");
        return;
      }
      try {
        const res = await fetchWithAuth(`/api/admin/monitor-check-runs/${runId}/trace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ properties: Array.from(new Set([...checkProperties, propKey])) }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || "Failed to trace this property");
          return;
        }
        const freshTrace = data.trace as CheckTrace;
        setTrace(freshTrace);
        const candidate =
          freshTrace.suggestions.find((s) => s.sourceKey === `${propKey}_first`) ??
          freshTrace.suggestions.find((s) => s.sourceKey === `${propKey}_count`) ??
          freshTrace.suggestions.find((s) => s.sourceKey.startsWith(`${propKey}_`));
        if (!candidate) {
          toast.error(
            `"${propKey}" didn't produce a rule-readable value on this response (object, array, or null on every item) — no suggestion available.`,
          );
          return;
        }
        acceptSuggestion(candidate);
      } catch (err: any) {
        toast.error(err.message || "Network error tracing that property");
      }
    },
    [runId, checkProperties, fetchWithAuth], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useImperativeHandle(ref, () => ({ suggestRuleForProperty }), [suggestRuleForProperty]);

  const visibleSuggestions = useMemo(
    () => (trace?.suggestions ?? []).filter(s => !discarded[s.sourceKey]),
    [trace, discarded],
  );

  const canTrace = !!runId && runStatus === "completed";

  return (
    <div className="mt-4 border-t border-border pt-3">
      {/* Header + the two clearly-distinguished actions */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Engine trace
          </span>
          {trace && (
            <span className="text-[10px] text-muted-foreground/70">
              {trace.coveredKeyCount} key{trace.coveredKeyCount === 1 ? "" : "s"} covered · {trace.uncoveredKeyCount} uncovered
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void handleReevaluate()}
            disabled={!canTrace || tracing}
            title="Re-applies the mapping and re-runs every rule against the response already captured by the last run. Does NOT call the tenant."
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            {tracing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Re-evaluate
            <span className="text-muted-foreground/60">· captured response</span>
          </button>
          <button
            onClick={onRerun}
            disabled={rerunning}
            title="Executes the endpoint against the live tenant again, then traces the fresh response. Real network call."
            className="flex items-center gap-1 rounded border border-primary/40 px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
          >
            {rerunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Re-run
            <span className="font-normal text-primary/70">· calls live tenant</span>
          </button>
        </div>
      </div>

      {!canTrace && (
        <p className="text-[11px] italic text-muted-foreground/70">
          {runStatus === "failed"
            ? "That run didn't return a usable response — there's nothing to trace. Fix the request and run again."
            : "Run this endpoint to trace what its response produces and which rules read it."}
        </p>
      )}

      {traceError && (
        <div className="mb-2 flex items-start gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{traceError}</span>
        </div>
      )}

      {trace && (
        <>
          {/* ── Produced keys, and what reads them ── */}
          <div className="space-y-1">
            {trace.keys.map(k => {
              const isOpen = expanded[k.key] ?? false;
              const firing = k.rules.filter(r => r.result).length;
              return (
                <div key={k.key} className="rounded border border-border bg-card">
                  <button
                    onClick={() => setExpanded(prev => ({ ...prev, [k.key]: !isOpen }))}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
                  >
                    {k.rules.length > 0 ? (
                      isOpen ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                        : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <span className="w-3 shrink-0" />
                    )}
                    <span className="truncate font-mono text-[11px] text-foreground">{k.key}</span>
                    <span className="shrink-0 font-mono text-[10px] text-primary">= {formatValue(k.value)}</span>
                    {k.origin === "mapping" && k.transform && k.transform !== "none" && (
                      <span className="shrink-0 rounded-sm border border-border px-1 text-[9px] text-muted-foreground">
                        {k.transform}({k.sourceField})
                      </span>
                    )}
                    {k.origin === "itemCount" && (
                      <span className="shrink-0 rounded-sm border border-border px-1 text-[9px] text-muted-foreground">
                        item count
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px]">
                      {k.uncovered ? (
                        <span className="text-amber-400">no rules read this</span>
                      ) : (
                        <span className="text-muted-foreground">
                          {k.rules.length} rule{k.rules.length === 1 ? "" : "s"} ·{" "}
                          <span className={firing > 0 ? "text-emerald-400" : "text-muted-foreground/70"}>
                            {firing} firing
                          </span>
                        </span>
                      )}
                    </span>
                  </button>

                  {isOpen && k.rules.length > 0 && (
                    <div className="border-t border-border">
                      {k.rules.map(r => (
                        <div key={r.ruleId} className="flex items-start gap-2 border-b border-border/50 px-2 py-1.5 last:border-b-0">
                          <span
                            className={`mt-px shrink-0 rounded-sm px-1 text-[9px] font-semibold uppercase ${
                              r.result
                                ? "bg-emerald-400/15 text-emerald-400"
                                : "bg-muted-foreground/10 text-muted-foreground"
                            }`}
                          >
                            {r.result ? "true" : "false"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[10px] text-foreground">{r.signalKey}</span>
                              <span className="text-[9px] text-muted-foreground">
                                {r.ruleType}
                                {r.compareValue != null && r.compareValue !== "" ? ` ${r.compareValue}` : ""}
                              </span>
                              <span className="text-[9px] text-muted-foreground/60">#{r.ruleId}</span>
                            </div>
                            {/* evaluateRule's own reason string, surfaced verbatim. */}
                            <p className="mt-0.5 break-words font-mono text-[10px] text-muted-foreground">{r.reason}</p>
                          </div>
                          <button
                            onClick={() => void openEditRule(r)}
                            title="Edit this real rule, then re-evaluate against the same response"
                            className="mt-px flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Pencil className="h-2.5 w-2.5" /> Edit
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Suggestions for uncovered keys ── */}
          {visibleSuggestions.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Suggested rules — {visibleSuggestions.length} uncovered propert
                  {visibleSuggestions.length === 1 ? "y" : "ies"}
                </span>
                <span className="text-[10px] text-muted-foreground/60">nothing is created until you accept and save</span>
              </div>
              <div className="space-y-1.5">
                {visibleSuggestions.map(s => (
                  <div key={s.sourceKey} className="rounded border border-amber-400/30 bg-amber-400/5 px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[11px] text-foreground">{s.sourceKey}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">= {formatValue(s.observedValue)}</span>
                      <span className="rounded-sm border border-amber-400/40 px-1 text-[9px] font-semibold text-amber-300">
                        {s.ruleType}
                        {s.compareValue != null ? ` ${s.compareValue}` : ""}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        pillar: {s.dominantPillar} · severity: {s.severity}
                      </span>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => acceptSuggestion(s)}
                          title="Open this suggestion as an editable draft — it is not inserted until you save it"
                          className="flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          <Check className="h-2.5 w-2.5" /> Accept
                        </button>
                        <button
                          onClick={() => setDiscarded(prev => ({ ...prev, [s.sourceKey]: true }))}
                          title="Hide this suggestion for now"
                          className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <X className="h-2.5 w-2.5" /> Discard
                        </button>
                      </div>
                    </div>
                    {/* The stated judgment call, including WHY that direction. */}
                    <p className="mt-1 break-words text-[10px] leading-relaxed text-muted-foreground">{s.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {trace.keys.length === 0 && (
            <p className="text-[11px] italic text-muted-foreground/70">
              This response produced no profile keys — the check has no mapping or extracted properties configured.
            </p>
          )}
        </>
      )}

      {/* The SHARED rule editor — the same component the Signal Rules page renders. */}
      <SignalRuleEditorModal
        open={ruleModalOpen}
        form={ruleForm}
        onFormChange={setRuleForm}
        editingRule={editingRule}
        signalKeys={signalKeys}
        groupOptions={groupsBySignal[ruleForm.signalKey] ?? []}
        saving={ruleSaving}
        error={ruleError}
        conflicts={ruleConflicts}
        onSave={() => void handleRuleSave()}
        onClose={() => setRuleModalOpen(false)}
        contextNote={modalNote}
        // A suggestion can name a signal that doesn't exist yet, so the trace
        // surface allows a free-text key on create (the page's dropdown-only
        // behaviour is unchanged).
        allowFreeTextSignalKey
      />

      {/* Plus-button affordance parity with the rules page: add a rule for this
          check directly, without waiting for a suggestion. */}
      {trace && (
        <button
          onClick={() => {
            setEditingRule(null);
            const form = emptyRuleForm("");
            form.sourceKey = "";
            setRuleForm(form);
            setModalNote(`New rule, created from the ${checkKey} trace. Nothing is written until you save.`);
            setRuleError(null);
            setRuleConflicts(null);
            setRuleModalOpen(true);
          }}
          className="mt-2 flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> New rule
        </button>
      )}
    </div>
  );
});

export default SimulatorEngineTrace;
