// artifacts/admin-panel/src/components/SimulatorPillarMatrixCanvas.tsx
//
// Center view for the Simulator Studio's "Pillar Matrix" node — a cross-signal
// tuning surface, distinct from the per-endpoint Engine Trace (which only shows
// the rules relevant to ONE selected endpoint's response).
//
// Pick a pillar (the seven real health/radar pillars) and this shows EVERY
// platform rule (signal_derivation_rules, msp_id IS NULL) whose OWN impact value
// for that pillar is non-zero, in one editable matrix, sorted highest-impact
// first — the most useful default for a retuning pass.
//
// Data comes from GET /api/admin/signal-rules/pillar-matrix, which reuses the
// SAME live-scoring fetch (fetchSignalRulesAndGroups — includes licensingImpact)
// and the SAME producible-key logic (computeRuleFedStatus / pillar-coverage) the
// customer-facing dashboard uses, so the header's theoreticalMax and the fed
// indicator agree with what the dashboard actually scores.
//
// Two realities this surface makes explicit, because the raw rule value hides
// them:
//   • fed / structurally inert — a high-impact rule whose sourceKey no real
//     monitor check can produce can never fire, so it protects no one. Shown as
//     the "Fed" column; inert rows are dimmed.
//   • dual-source MAX — the engine scores a signal's pillar value as the MAX
//     across that signal's rules AND its group, so a non-zero rule value can be
//     inert for scoring when the group or a sibling rule configures a higher one.
//     Shown as the "Effective" column with a note when the rule's own value is
//     not the winning source.
//
// Inline edits are batched: change any number of rows, then Save. Each save goes
// back through the existing per-rule PATCH /api/admin/signal-rules/:id — no draft
// or gating; a saved value takes effect on live scoring immediately. Unsaved rows
// are visually unambiguous (amber left-border + dot, and a per-row revert).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save, RotateCcw, RefreshCw, AlertTriangle, Zap, ZapOff, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimulatorEndpointCanvas, type MonitorCheckSummary } from "./SimulatorEndpointCanvas";

// Mirrors PILLAR_LABELS in api-server lib/pillar-coverage.ts (same order the
// spec lists them). The pillar key is sent verbatim to the endpoint.
const PILLARS = [
  { key: "governance", label: "Governance" },
  { key: "security", label: "Security" },
  { key: "compliance", label: "Compliance" },
  { key: "adoption", label: "Adoption" },
  { key: "copilot", label: "Copilot Readiness" },
  { key: "architecture", label: "Architecture" },
  { key: "licensing", label: "Licensing" },
] as const;

export type PillarKey = (typeof PILLARS)[number]["key"];

interface MatrixRow {
  ruleId: number;
  signalKey: string;
  ruleType: string;
  sourceKey: string;
  groupId: number | null;
  description: string | null;
  ruleImpact: number;
  groupImpact: number;
  effectiveSignalImpact: number;
  isWinningSource: boolean;
  fed: boolean;
  signalEvaluable: boolean;
  /** The real monitor check that owns this rule's sourceKey, if resolvable — null means no real check can be opened for it. */
  checkKey: string | null;
}

interface MatrixResponse {
  pillar: PillarKey;
  label: string;
  /** The intelligence-field name the PATCH body must use, e.g. "governanceImpact". */
  field: string;
  theoreticalMax: number;
  contributingSignalCount: number;
  ruleCount: number;
  fedRuleCount: number;
  rows: MatrixRow[];
}

interface CustomerPillarScore {
  pillar: string;
  label: string;
  score: number | null;
}

export function SimulatorPillarMatrixCanvas({ initialPillar }: { initialPillar?: PillarKey }) {
  const { fetchWithAuth } = useAuth();
  const { selectedCustomerId, selectedCustomer } = useTestbedContext();

  const [pillar, setPillar] = useState<PillarKey>(initialPillar ?? "governance");
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ruleId -> the currently-typed value. A row is dirty iff its edited value
  // differs from the row's persisted ruleImpact. Kept keyed by id so a refetch
  // (which rebuilds `rows`) can drop resolved edits by comparison.
  const [edits, setEdits] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);

  // Live pillar-score header for whichever customer is selected in the shared
  // testbed picker — lets Shane verify a tuning change's real effect on that
  // customer's actual dashboard scores without logging in as them separately.
  // Reuses the SAME computation the customer dashboard uses (see
  // GET /admin/signal-rules/customer-pillar-scores/:customerId).
  const [customerScores, setCustomerScores] = useState<CustomerPillarScore[] | null>(null);
  const [loadingScores, setLoadingScores] = useState(false);

  const loadCustomerScores = useCallback(
    async (customerId: number) => {
      setLoadingScores(true);
      try {
        const res = await fetchWithAuth(`/api/admin/signal-rules/customer-pillar-scores/${customerId}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as { pillars: CustomerPillarScore[] };
        setCustomerScores(json.pillars);
      } catch {
        setCustomerScores(null);
      } finally {
        setLoadingScores(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    if (selectedCustomerId != null) {
      void loadCustomerScores(selectedCustomerId);
    } else {
      setCustomerScores(null);
    }
  }, [selectedCustomerId, loadCustomerScores]);

  // Rule-row trace modal — reuses the real Phase 2 Engine Trace experience
  // (SimulatorEngineTrace, embedded in SimulatorEndpointCanvas) exactly as it
  // renders from the M365 Endpoints tree, scoped to the clicked rule's real
  // owning check. No second trace surface is built.
  const [traceCheck, setTraceCheck] = useState<MonitorCheckSummary | null>(null);
  const [loadingTraceKey, setLoadingTraceKey] = useState<string | null>(null);

  const openRuleTrace = async (checkKey: string) => {
    setLoadingTraceKey(checkKey);
    try {
      const res = await fetchWithAuth(`/api/admin/monitor-checks/${encodeURIComponent(checkKey)}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = (await res.json()) as { check: MonitorCheckSummary };
      setTraceCheck(json.check);
    } catch (err) {
      toast.error("Failed to open rule trace", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoadingTraceKey(null);
    }
  };

  // A tree click can re-select the same or a different pillar after mount.
  useEffect(() => {
    if (initialPillar) setPillar(initialPillar);
  }, [initialPillar]);

  const load = useCallback(
    async (p: PillarKey) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchWithAuth(`/api/admin/signal-rules/pillar-matrix?pillar=${encodeURIComponent(p)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const json = (await res.json()) as MatrixResponse;
        setData(json);
        setEdits({}); // switching pillars / reloading discards unsaved edits
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load pillar matrix");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    void load(pillar);
  }, [pillar, load]);

  const dirtyIds = useMemo(() => {
    if (!data) return [] as number[];
    const byId = new Map(data.rows.map((r) => [r.ruleId, r.ruleImpact]));
    return Object.keys(edits)
      .map(Number)
      .filter((id) => byId.has(id) && edits[id] !== byId.get(id));
  }, [edits, data]);

  const setRowValue = (ruleId: number, raw: string) => {
    const n = raw === "" ? 0 : Number(raw);
    if (Number.isNaN(n)) return;
    setEdits((prev) => ({ ...prev, [ruleId]: Math.trunc(n) }));
  };

  const revertRow = (ruleId: number) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[ruleId];
      return next;
    });
  };

  const revertAll = () => setEdits({});

  const save = async () => {
    if (!data || dirtyIds.length === 0) return;
    setSaving(true);
    const field = data.field;
    let ok = 0;
    const failures: string[] = [];
    // Sequential PATCHes through the existing per-rule endpoint — small counts,
    // and it keeps the conflict-detection error from one rule from being masked
    // by a Promise.all race. No new bulk endpoint (reuses rule-update).
    for (const ruleId of dirtyIds) {
      try {
        const res = await fetchWithAuth(`/api/admin/signal-rules/${ruleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: edits[ruleId] }),
        });
        if (res.ok) {
          ok++;
        } else {
          const body = await res.json().catch(() => ({}));
          failures.push(`#${ruleId}: ${body.error || res.status}`);
        }
      } catch (err) {
        failures.push(`#${ruleId}: ${err instanceof Error ? err.message : "network error"}`);
      }
    }
    setSaving(false);

    if (ok > 0) {
      toast.success(`Saved ${ok} rule${ok === 1 ? "" : "s"} — live scoring updated`);
      window.dispatchEvent(
        new CustomEvent("simulator-log", {
          detail: { type: "success", message: `Pillar Matrix (${data.label}): ${ok} rule impact(s) saved to live scoring` },
        }),
      );
    }
    if (failures.length > 0) {
      toast.error(`${failures.length} save(s) failed`, { description: failures.slice(0, 3).join("  •  ") });
    }
    // Refetch so theoreticalMax / effective / fed all reflect the new values,
    // and successfully-saved edits drop out of the dirty set.
    await load(pillar);
    // Recompute the selected customer's real pillar scores so the header
    // reflects this save's actual effect immediately — no manual reload.
    if (ok > 0 && selectedCustomerId != null) {
      void loadCustomerScores(selectedCustomerId);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background font-sans">
      {/* ── Header: pillar selector + live summary ── */}
      <div className="flex-shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pillar</span>
            <select
              value={pillar}
              onChange={(e) => setPillar(e.target.value as PillarKey)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
            >
              {PILLARS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => void load(pillar)}
            disabled={loading}
            className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            title="Reload from live scoring config"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Reload
          </button>

          <div className="ml-auto flex items-center gap-2">
            {dirtyIds.length > 0 && (
              <button
                onClick={revertAll}
                disabled={saving}
                className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                Revert {dirtyIds.length}
              </button>
            )}
            <button
              onClick={() => void save()}
              disabled={saving || dirtyIds.length === 0}
              className={`flex items-center gap-1.5 rounded px-3 py-1 text-[11px] font-semibold transition-colors ${
                dirtyIds.length > 0
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "cursor-not-allowed bg-accent text-muted-foreground"
              }`}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {saving ? "Saving…" : dirtyIds.length > 0 ? `Save ${dirtyIds.length} change${dirtyIds.length === 1 ? "" : "s"}` : "Save"}
            </button>
          </div>
        </div>

        {/* Summary stats — these are the config-side numbers that back the
            customer-facing dashboard for this pillar. */}
        {data && (
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px]">
            <Stat label="theoreticalMax" value={data.theoreticalMax} mono />
            <Stat label="contributing signals" value={data.contributingSignalCount} mono />
            <Stat label="rules in view" value={data.ruleCount} mono />
            <Stat label="of which fed" value={`${data.fedRuleCount} / ${data.ruleCount}`} mono />
            <span className="text-muted-foreground/70">
              theoreticalMax counts only genuinely-fed signals — the same denominator the dashboard uses.
            </span>
          </div>
        )}

        {/* Live pillar-score header for the selected testbed customer — the
            SAME real computeDisplayHealth/computePillarDisplayScore chain the
            customer dashboard uses, recomputed automatically after every save
            so a tuning change's real effect is visible immediately. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border/60 pt-2 text-[11px]">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {loadingScores && <Loader2 className="h-3 w-3 animate-spin" />}
            {selectedCustomer ? `${selectedCustomer.name} — live scores` : "Live customer scores"}
          </span>
          {selectedCustomerId == null ? (
            <span className="text-muted-foreground/70">Select a testbed customer to see real pillar scores.</span>
          ) : customerScores ? (
            customerScores.map((s) => (
              <span key={s.pillar} className="flex items-baseline gap-1">
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {s.score ?? "—"}
                </span>
                <span className="text-muted-foreground">{s.label}</span>
              </span>
            ))
          ) : !loadingScores ? (
            <span className="text-muted-foreground/70">Failed to load pillar scores for this customer.</span>
          ) : null}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="mx-auto mt-10 max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center text-xs text-destructive">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {error}
          </div>
        ) : data && data.rows.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md text-center text-xs text-muted-foreground">
            No platform rule configures a non-zero <span className="font-mono text-foreground/80">{data.field}</span> for{" "}
            <span className="font-semibold text-foreground/80">{data.label}</span> yet.
          </div>
        ) : data ? (
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 select-none bg-card">
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Signal</th>
                <th className="px-3 py-2 font-semibold">Rule</th>
                <th className="px-3 py-2 text-center font-semibold" title="Can any real monitor check produce this rule's sourceKey?">
                  Fed
                </th>
                <th className="px-3 py-2 text-right font-semibold">Impact</th>
                <th className="px-3 py-2 text-right font-semibold" title="Engine-effective value = MAX across this signal's rules and its group">
                  Effective
                </th>
                <th className="px-3 py-2 font-semibold">Source of record</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const edited = edits[row.ruleId];
                const isDirty = edited !== undefined && edited !== row.ruleImpact;
                const value = edited !== undefined ? edited : row.ruleImpact;
                return (
                  <tr
                    key={row.ruleId}
                    className={`border-b border-border/60 transition-colors hover:bg-accent/20 ${
                      isDirty ? "bg-amber-400/5" : ""
                    } ${!row.fed ? "opacity-60" : ""}`}
                  >
                    {/* Signal */}
                    <td className="px-3 py-1.5 align-top">
                      <div className="flex items-center gap-1.5">
                        {isDirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Unsaved change" />}
                        <span className="font-mono text-foreground/90" title={row.description || undefined}>
                          {row.signalKey}
                        </span>
                      </div>
                      {!row.signalEvaluable && (
                        <span className="mt-0.5 block text-[9px] uppercase tracking-wider text-amber-400/70">
                          signal not evaluable
                        </span>
                      )}
                    </td>

                    {/* Rule (type + sourceKey) */}
                    <td className="px-3 py-1.5 align-top">
                      <span className="rounded bg-accent px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                        {row.ruleType}
                      </span>{" "}
                      <span className="font-mono text-foreground/70">{row.sourceKey}</span>
                    </td>

                    {/* Fed indicator */}
                    <td className="px-3 py-1.5 text-center align-top">
                      {row.fed ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400" title="A real monitor check can produce this rule's sourceKey">
                          <Zap className="h-3 w-3" />
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-amber-400/80"
                          title="No monitor check can produce this rule's sourceKey — it can never fire (structurally inert)"
                        >
                          <ZapOff className="h-3 w-3" />
                        </span>
                      )}
                    </td>

                    {/* Editable impact */}
                    <td className="px-3 py-1.5 text-right align-top">
                      <div className="flex items-center justify-end gap-1.5">
                        {isDirty && (
                          <button
                            onClick={() => revertRow(row.ruleId)}
                            className="text-muted-foreground/60 transition-colors hover:text-foreground"
                            title={`Revert to ${row.ruleImpact}`}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                        <input
                          type="number"
                          value={value}
                          onChange={(e) => setRowValue(row.ruleId, e.target.value)}
                          className={`w-16 rounded border bg-background px-1.5 py-0.5 text-right font-mono text-[11px] tabular-nums focus:outline-none ${
                            isDirty
                              ? "border-amber-400/60 text-amber-300 focus:border-amber-400"
                              : "border-border text-foreground focus:border-ring"
                          }`}
                        />
                      </div>
                    </td>

                    {/* Effective (engine MAX) */}
                    <td className="px-3 py-1.5 text-right align-top font-mono tabular-nums text-foreground/70">
                      {row.effectiveSignalImpact}
                    </td>

                    {/* Source of record — makes the dual-source reality explicit.
                        Clickable when a real check owns this rule's sourceKey: opens
                        the real Engine Trace for that check, scoped to this rule. */}
                    <td className="px-3 py-1.5 align-top text-[10px]">
                      {row.checkKey ? (
                        <button
                          onClick={() => void openRuleTrace(row.checkKey!)}
                          disabled={loadingTraceKey === row.checkKey}
                          className={`inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground disabled:opacity-50 ${
                            row.isWinningSource ? "text-muted-foreground/70" : "text-amber-400/80"
                          }`}
                          title={`Open the real Engine Trace for ${row.checkKey}`}
                        >
                          {loadingTraceKey === row.checkKey ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <ExternalLink className="h-2.5 w-2.5" />
                          )}
                          {row.isWinningSource
                            ? "this rule"
                            : row.groupImpact >= row.effectiveSignalImpact && row.groupId != null
                              ? `group (${row.groupImpact}) overrides`
                              : `sibling rule (${row.effectiveSignalImpact}) overrides`}
                        </button>
                      ) : row.isWinningSource ? (
                        <span className="text-muted-foreground/70">this rule</span>
                      ) : (
                        <span className="text-amber-400/80" title="A group or a sibling rule configures a higher value, so this rule's value is inert for scoring">
                          {row.groupImpact >= row.effectiveSignalImpact && row.groupId != null
                            ? `group (${row.groupImpact}) overrides`
                            : `sibling rule (${row.effectiveSignalImpact}) overrides`}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>

      {/* Rule trace modal — the real Phase 2 Engine Trace (SimulatorEngineTrace,
          embedded in SimulatorEndpointCanvas exactly as the M365 Endpoints tab
          renders it), scoped to the clicked rule's owning check. Overlay, not a
          navigation — the matrix stays mounted underneath. */}
      <Dialog open={traceCheck != null} onOpenChange={(open) => { if (!open) setTraceCheck(null); }}>
        <DialogContent className="flex h-[85vh] max-w-5xl flex-col overflow-hidden p-0">
          {traceCheck && (
            <>
              <DialogHeader className="flex-shrink-0 border-b border-border px-4 py-3">
                <DialogTitle className="font-mono text-sm">{traceCheck.key}</DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-auto">
                <SimulatorEndpointCanvas check={traceCheck} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`font-semibold text-foreground ${mono ? "font-mono tabular-nums" : ""}`}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
