/**
 * SimulatorConfigPackCanvas.tsx
 *
 * Center canvas for the Simulator "Config Packs" surface — an ORCHESTRATED
 * sequence of the same real baseline_action_templates the Write Actions surface
 * runs one-at-a-time. A pack carries the same real tenant-mutating risk, so it
 * carries the same real safety posture:
 *
 *   1. Testbed-only, SERVER-enforced. Both execution paths reused here reject a
 *      non-testbed customer server-side (POST .../config-packs/:key/run ->
 *      customer_not_testbed; POST .../write-actions/:id/execute -> 403). The UI
 *      picker only offering testbeds is never the gate.
 *   2. Explicit confirmation before ANY execution — a whole-pack run shows the
 *      full resolved step sequence + the gate position; a single step hands off
 *      to the Write Actions runner, which shows the exact resolved request.
 *   3. The REAL dependency order is surfaced and respected. The step list is the
 *      plan the run endpoint materializes (GET .../run/plan — same
 *      buildConfigPackGraph that executes it), so nothing is shown out of the
 *      order it will actually run. dependsOn is shown per step.
 *   4. ONE execution engine. Whole-pack runs go through the Workflow Engine
 *      (each step an execute_baseline_template node -> runBaselineTemplateAgainstTenant);
 *      single steps go through the existing SimulatorWriteActionCanvas. Neither
 *      is a second execution implementation.
 *   5. Live progress. A whole-pack run polls the real wf_run and shows per-step
 *      status through the real sequence, stopping (and reporting) on failure or
 *      at the verification gate.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Play,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  X,
  CheckCircle2,
  XCircle,
  CircleDashed,
  MinusCircle,
  ArrowUpRight,
  KeyRound,
  ListOrdered,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import type { ConfigPackNode, WriteActionNode } from "./SimulatorLeftTree";
import {
  deriveStepStatuses,
  isRunSettled,
  packProgress,
  resolveStepWriteAction,
  runPhase,
  type ConfigPackPlan,
  type StepRunState,
  type StepRunStatus,
  type WfRunSnapshot,
} from "./simulatorConfigPack";

interface TestbedCustomerOption {
  id: number;
  name: string | null;
  tenantId: string;
}

interface RunStartResponse {
  runId: number;
  templateOrder: string[];
  gated: boolean;
  reusedVersion: boolean;
}

// ~5 minutes of polling at 1500ms per tick — the same budget the suite-run
// poller in SimulatorLeftTree uses.
const RUN_POLL_INTERVAL_MS = 1500;
const RUN_POLL_MAX_TICKS = 200;

function methodBadgeClass(method: string): string {
  return method === "DELETE"
    ? "bg-red-500/15 text-red-400"
    : method === "POST"
      ? "bg-emerald-500/15 text-emerald-400"
      : "bg-amber-500/15 text-amber-400";
}

function StepStatusIcon({ status }: { status: StepRunStatus }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-label="succeeded" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-400" aria-label="failed" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-label="running" />;
    case "skipped":
      return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" aria-label="skipped" />;
    case "not_run":
      return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/50" aria-label="not run" />;
    default:
      return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/40" aria-label="pending" />;
  }
}

export function SimulatorConfigPackCanvas({ pack }: { pack: ConfigPackNode }) {
  const { fetchWithAuth } = useAuth();
  const { selectedCustomerId } = useTestbedContext();

  const [customers, setCustomers] = useState<TestbedCustomerOption[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [writeActions, setWriteActions] = useState<WriteActionNode[]>([]);

  const [plan, setPlan] = useState<ConfigPackPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);

  const [operatorVars, setOperatorVars] = useState<Record<string, string>>({});

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  // Live run state.
  const [templateOrder, setTemplateOrder] = useState<string[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [runGated, setRunGated] = useState(false);
  const [run, setRun] = useState<WfRunSnapshot | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // ── Load testbed customers + the write-action catalog (for single-step reuse) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tbRes, waRes] = await Promise.all([
          fetchWithAuth("/api/admin/write-actions/testbed-customers"),
          fetchWithAuth("/api/admin/write-actions"),
        ]);
        if (!cancelled && tbRes.ok) {
          const data = await tbRes.json();
          const list: TestbedCustomerOption[] = data.customers || [];
          setCustomers(list);
          setCustomerId((prev) =>
            prev ?? (list.some((c) => c.id === selectedCustomerId) ? selectedCustomerId : list[0]?.id ?? null),
          );
        }
        if (!cancelled && waRes.ok) {
          const data = await waRes.json();
          setWriteActions(data.templates || []);
        }
      } catch {
        /* offline — pickers just stay empty */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomerId]);

  // ── Load the real execution plan for this pack ──
  const loadPlan = useCallback(async () => {
    setLoadingPlan(true);
    setPlanError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/config-packs/${encodeURIComponent(pack.packKey)}/run/plan`);
      const data = await res.json();
      if (!res.ok) {
        setPlan(null);
        setPlanError(data.error || "This pack cannot be planned");
        return;
      }
      setPlan(data as ConfigPackPlan);
      // Seed operator-variable inputs empty (never a destructive default).
      const seed: Record<string, string> = {};
      for (const v of (data as ConfigPackPlan).operatorVariables) seed[v] = "";
      setOperatorVars(seed);
    } catch (err) {
      setPlan(null);
      setPlanError(err instanceof Error ? err.message : "Failed to load the pack plan");
    } finally {
      setLoadingPlan(false);
    }
  }, [fetchWithAuth, pack.packKey]);

  // Re-seed everything when a different pack is opened.
  useEffect(() => {
    stopPolling();
    setPlan(null);
    setPlanError(null);
    setConfirmOpen(false);
    setTemplateOrder([]);
    setRunId(null);
    setRun(null);
    setRunGated(false);
    void loadPlan();
    return () => stopPolling();
  }, [pack.packKey, loadPlan, stopPolling]);

  const writeActionsById = new Map(writeActions.map((w) => [w.templateId, w]));

  const operatorVarsReady = (plan?.operatorVariables ?? []).every((v) => (operatorVars[v] ?? "").trim() !== "");
  const canRun = plan != null && plan.ordered.length > 0 && customerId != null && operatorVarsReady && !starting && runId == null;

  // ── Poll the live run ──
  const startPolling = useCallback(
    (id: number) => {
      stopPolling();
      let ticks = 0;
      let inFlight = false;
      const tick = async () => {
        ticks += 1;
        if (inFlight) return;
        inFlight = true;
        try {
          const res = await fetchWithAuth(`/api/admin/workflows/runs/${id}`);
          if (res.ok) {
            const data = (await res.json()) as WfRunSnapshot;
            setRun(data);
            if (isRunSettled(data)) {
              stopPolling();
              const phase = runPhase(data);
              if (phase === "succeeded") toast.success("Config pack run completed");
              else if (phase === "paused") toast("Pack paused at the verification gate — resume via break-glass verification");
              else if (phase === "failed") toast.error("Config pack run failed — a step did not succeed");
              else if (phase === "cancelled") toast.error("Config pack run was cancelled");
              return;
            }
          }
        } catch {
          /* transient — keep polling until the tick budget runs out */
        } finally {
          inFlight = false;
        }
        if (ticks >= RUN_POLL_MAX_TICKS) {
          stopPolling();
          toast.error("Stopped watching the run after 5 minutes — check the Workflow Runs page");
        }
      };
      pollTimerRef.current = window.setInterval(() => void tick(), RUN_POLL_INTERVAL_MS);
      // Fire one immediately so the UI doesn't sit blank for the first interval.
      void tick();
    },
    [fetchWithAuth, stopPolling],
  );

  const handleStartRun = async () => {
    if (customerId == null || plan == null) return;
    setStarting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/config-packs/${encodeURIComponent(pack.packKey)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, variables: operatorVars }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Testbed refusal / missing vars / concurrency — a specific outcome, surfaced.
        toast.error(data.error || "The pack run was refused");
        return;
      }
      const start = data as RunStartResponse;
      setTemplateOrder(start.templateOrder);
      setRunId(start.runId);
      setRunGated(start.gated);
      setRun(null);
      setConfirmOpen(false);
      toast.success(`Pack run #${start.runId} started`);
      startPolling(start.runId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error starting the pack run");
    } finally {
      setStarting(false);
    }
  };

  const handleResetRun = () => {
    stopPolling();
    setRunId(null);
    setRun(null);
    setTemplateOrder([]);
    setRunGated(false);
  };

  // Single-step: hand off to the EXISTING Write Actions runner (its confirmation,
  // preview, and dependsOn "was it run" tracking) — never a second execute path.
  const handleRunSingleStep = (templateId: string) => {
    const node = resolveStepWriteAction(templateId, writeActions);
    if (!node) {
      toast.error("This step's write-action template isn't in the catalog — cannot run it in isolation");
      return;
    }
    window.dispatchEvent(new CustomEvent("simulator-select-write-action", { detail: node }));
  };

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  // Live per-step statuses mapped onto the run's authoritative templateOrder,
  // falling back to the plan order before a run starts.
  const orderForDisplay = templateOrder.length > 0 ? templateOrder : (plan?.ordered.map((s) => s.templateId) ?? []);
  const stepStates: StepRunState[] = deriveStepStatuses(orderForDisplay, run);
  const stepStateById = new Map(stepStates.map((s) => [s.templateId, s]));
  const progress = packProgress(stepStates);
  const phase = runPhase(run);

  return (
    <div className="flex-1 overflow-y-auto p-4 font-sans text-foreground">
      {/* Header */}
      <div className="mb-1 flex items-center gap-2">
        <ListOrdered className="h-4 w-4 shrink-0 text-primary" />
        <h2 className="truncate text-sm font-semibold">{pack.label}</h2>
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{pack.packKey}</span>
        {pack.status !== "active" && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-400">{pack.status}</span>
        )}
        {plan?.gatedTemplateId && (
          <span className="ml-auto flex shrink-0 items-center gap-1 rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300" title="This pack pauses at a break-glass verification gate">
            <KeyRound className="h-3 w-3" /> gated
          </span>
        )}
      </div>
      {pack.description && <p className="mb-3 text-[12px] text-muted-foreground">{pack.description}</p>}

      {/* Testbed-only banner — the load-bearing restriction, made visible */}
      <div className="mb-3 flex items-start gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Running this pack executes a <strong>real, orchestrated sequence of tenant-mutating writes</strong> in dependency order. It runs only
          against a <strong>testbed</strong> customer, and the server rejects any non-testbed target. Each step is a real Write Action.
        </span>
      </div>

      {/* Testbed customer picker */}
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Target testbed tenant</label>
      <select
        value={customerId ?? ""}
        onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)}
        disabled={runId != null}
        className="mb-3 w-full rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground focus:border-ring focus:outline-none disabled:opacity-60"
      >
        <option value="">— select a testbed customer —</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name ?? `Customer ${c.id}`}
          </option>
        ))}
      </select>
      {customers.length === 0 && (
        <div className="mb-3 text-[11px] italic text-muted-foreground/70">No testbed customers with a connected tenant were found.</div>
      )}

      {/* Operator variables (required vars with no derivable source, e.g. tenantPrefix) */}
      {plan && plan.operatorVariables.length > 0 && (
        <div className="mb-3 space-y-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Required inputs (no derivable source)
          </label>
          {plan.operatorVariables.map((v) => (
            <div key={v} className="flex items-center gap-2">
              <span className="w-40 shrink-0 truncate font-mono text-[11px] text-foreground/85">{v}</span>
              <input
                value={operatorVars[v] ?? ""}
                onChange={(e) => setOperatorVars((prev) => ({ ...prev, [v]: e.target.value }))}
                disabled={runId != null}
                spellCheck={false}
                className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:border-ring focus:outline-none disabled:opacity-60"
              />
            </div>
          ))}
        </div>
      )}

      {/* Plan error (inactive/empty pack, dependency cycle, unknown dep) */}
      {planError && (
        <div className="mb-3 flex items-start gap-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{planError}</span>
        </div>
      )}

      {/* Run controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={!canRun}
          className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          title={customerId == null ? "Select a testbed customer first" : !operatorVarsReady ? "Fill in the required inputs first" : "Run every step in dependency order"}
        >
          {starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 fill-current" />}
          Run whole pack
        </button>
        {runId != null && (
          <button
            onClick={handleResetRun}
            disabled={pollTimerRef.current != null && !isRunSettled(run)}
            className="rounded border border-border px-3 py-1.5 text-[11px] text-foreground hover:bg-accent disabled:opacity-40"
            title={pollTimerRef.current != null && !isRunSettled(run) ? "Run still in progress" : "Clear this run and enable another"}
          >
            Clear run
          </button>
        )}
        <span className="text-[11px] text-muted-foreground">
          {loadingPlan ? "Loading plan…" : plan ? `${plan.ordered.length} step${plan.ordered.length === 1 ? "" : "s"}, run in dependency order` : ""}
        </span>
      </div>

      {/* Live progress bar */}
      {runId != null && (
        <div className="mb-4 rounded border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px]">
            <span className="font-semibold text-foreground">Run #{runId}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                phase === "succeeded"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : phase === "failed" || phase === "cancelled"
                    ? "bg-red-500/15 text-red-400"
                    : phase === "paused"
                      ? "bg-amber-500/15 text-amber-400"
                      : "bg-primary/15 text-primary"
              }`}
            >
              {phase}
            </span>
            {runGated && phase === "paused" && (
              <span className="flex items-center gap-1 text-amber-300">
                <KeyRound className="h-3 w-3" /> awaiting tenant-admin verification
              </span>
            )}
            <span className="ml-auto tabular-nums text-muted-foreground">
              {progress.reached}/{progress.total} steps{progress.failed > 0 ? ` · ${progress.failed} failed` : ""}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
            <div
              className={`h-full rounded-full transition-all ${progress.anyFailed ? "bg-red-500" : phase === "succeeded" ? "bg-emerald-500" : "bg-primary"}`}
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Step list — REAL execution order */}
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Steps (real dependency order)
      </label>
      {plan == null ? (
        <div className="text-[11px] italic text-muted-foreground/70">{loadingPlan ? "Loading…" : "No plan available."}</div>
      ) : (
        <div className="divide-y divide-border rounded border border-border">
          {plan.ordered.map((step, idx) => {
            const wa = writeActionsById.get(step.templateId);
            const state = stepStateById.get(step.templateId);
            return (
              <div key={step.templateId}>
                <div className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
                  <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground/60">{idx + 1}</span>
                  {state ? <StepStatusIcon status={state.status} /> : <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/40" />}
                  {wa && (
                    <span className={`shrink-0 rounded px-1 text-[9px] font-bold uppercase tracking-wider ${methodBadgeClass(wa.method)}`}>{wa.method}</span>
                  )}
                  <span className="flex-1 truncate" title={wa?.description || step.label}>
                    {step.label}
                  </span>
                  {!wa?.reversible && wa && (
                    <span className="shrink-0 text-[9px] uppercase tracking-wider text-red-400/70" title="No single-step rollback path">1-way</span>
                  )}
                  <button
                    onClick={() => handleRunSingleStep(step.templateId)}
                    disabled={runId != null}
                    className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/80 transition-colors hover:bg-accent hover:text-primary disabled:opacity-40"
                    title="Run just this step in the Write Actions runner (with its own confirmation)"
                  >
                    <ArrowUpRight className="h-3 w-3" /> Run step
                  </button>
                </div>
                {/* endpoint + dependency + gate detail */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1.5 pl-9 text-[10px]">
                  {wa && <span className="break-all font-mono text-muted-foreground/70">{wa.endpoint}</span>}
                  {step.effectiveDependsOn.length > 0 && (
                    <span className="flex items-center gap-1 text-amber-300/80" title="Runs after these steps">
                      <AlertTriangle className="h-3 w-3" /> after: {step.effectiveDependsOn.join(", ")}
                    </span>
                  )}
                  {step.requiresVerificationGate && (
                    <span className="flex items-center gap-1 text-amber-300/80">
                      <KeyRound className="h-3 w-3" /> verification gate
                      {step.gatedHere ? " (pauses here)" : " (covered by earlier gate)"}
                    </span>
                  )}
                  {state?.status === "failed" && state.errorMessage && (
                    <span className="text-red-300">{state.errorMessage}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Whole-pack confirmation ── */}
      {confirmOpen && plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !starting && setConfirmOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold">
                Run “{plan.label}” against {selectedCustomer?.name ?? `Customer ${customerId}`}
              </h3>
              <button onClick={() => !starting && setConfirmOpen(false)} className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mb-3 text-[12px] text-muted-foreground">
              This executes the following {plan.ordered.length} real write{plan.ordered.length === 1 ? "" : "s"} in order against the tenant.
              A step that fails stops the run — later steps do not run. Per-step request bodies resolve at execution time
              {plan.gatedTemplateId ? " (including the mid-run break-glass values), and the run pauses at the verification gate" : ""}.
            </p>

            <div className="mb-3 divide-y divide-border rounded border border-border">
              {plan.ordered.map((step, idx) => {
                const wa = writeActionsById.get(step.templateId);
                return (
                  <div key={step.templateId} className="flex items-center gap-2 px-2 py-1 font-mono text-[11px]">
                    <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground/60">{idx + 1}</span>
                    {wa && <span className={`shrink-0 rounded px-1 text-[9px] font-bold ${methodBadgeClass(wa.method)}`}>{wa.method}</span>}
                    <span className="truncate text-foreground/80" title={wa?.endpoint}>{wa?.endpoint ?? step.templateId}</span>
                    {step.gatedHere && <span className="ml-auto flex shrink-0 items-center gap-1 text-amber-300"><KeyRound className="h-3 w-3" />gate</span>}
                  </div>
                );
              })}
            </div>

            {plan.operatorVariables.length > 0 && (
              <div className="mb-3 rounded border border-border bg-card p-2 text-[11px]">
                <div className="mb-1 font-semibold text-foreground">Inputs</div>
                {plan.operatorVariables.map((v) => (
                  <div key={v} className="flex items-center gap-2 font-mono">
                    <span className="text-muted-foreground">{v}:</span>
                    <span className="text-foreground/85">{operatorVars[v]}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} disabled={starting} className="rounded border border-border px-3 py-1.5 text-[11px] text-foreground hover:bg-accent disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={handleStartRun}
                disabled={starting}
                className="flex items-center gap-1 rounded bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 fill-current" />}
                Execute this real sequence
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reversibility note */}
      {plan && (
        <div className="mt-3 flex items-start gap-2 text-[10px] text-muted-foreground/70">
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Single steps run through the Write Actions runner with its own confirmation and rollback surfacing. A whole-pack run executes through the
            Workflow Engine — watch it on the Workflow Runs page too.
          </span>
        </div>
      )}
    </div>
  );
}
