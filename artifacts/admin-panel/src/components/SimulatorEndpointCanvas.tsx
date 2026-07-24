// artifacts/admin-panel/src/components/SimulatorEndpointCanvas.tsx
//
// Center view for the Simulator Studio's "M365 Endpoints" node (phase 1).
//
// Shows the real stored config of one monitor_checks row — URL, method, and the
// request-shaping parameters (select_params / request_body / properties) — with
// every field pre-filled from that check's OWN stored config and editable before
// running. Running issues ONE real request against the selected testbed
// customer's real connected tenant via POST /api/admin/monitor-checks/:key/run,
// then polls GET /api/admin/monitor-check-runs/:runId for real progress.
//
// Phase 2 adds the engine trace below the response (SimulatorEngineTrace): what
// profile keys this response really produces, which real signal_derivation_rules
// read them, whether each fires, and editable suggestions for keys no rule
// covers. "Re-evaluate" there re-traces the captured response with no network
// call; "Re-run" calls handleRun below, hitting the live tenant again.
//
// Phase 3 adds the run history panel (SimulatorRunHistory) beneath it. Runs are
// now persisted in the real `simulator_check_runs` table rather than a
// process-local Map, so "Open" can load a run started before the last
// api-server restart back into this canvas, and two runs can be compared.
//
// Phase 4 adds failure auto-classification and tie-to-action. When a run fails,
// the server classifies its REAL error text (api-server
// lib/monitor-failure-classifier.ts) and the verdict renders directly under the
// run status, above the response — the first thing visible on a failure, because
// the point of the phase is to replace an evening of reading raw error_message
// text with a glance. The suggested action never applies itself: "Edit endpoint"
// focuses a field in the form already on this page, and "Retire this check" runs
// the same confirmed, reversible archive action the header's Retire button uses.
// MISSING PERMISSION has no action at all — it names the permission and says
// where it is declared, because adding one forces re-consent on every connected
// tenant and stays a deliberate human decision.
//
// Deliberately NOT here (later phase, per the sequenced spec): write endpoints.
//
// Editing a parameter here does NOT mutate the catalog row — the run route takes
// per-run overrides. Persisting a change is the explicit "Save changes" action,
// which PATCHes the existing /api/admin/monitor-checks/:key CRUD route.

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, Save, Archive, RotateCcw, Lightbulb } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import { JsonResponseViewer } from "./JsonResponseViewer";
import { SimulatorEngineTrace, type SimulatorEngineTraceHandle } from "./SimulatorEngineTrace";
import { SimulatorRunHistory } from "./SimulatorRunHistory";
import {
  SimulatorFailureClassification,
  type FailureClassification,
} from "./SimulatorFailureClassification";
import { stripSelectParam } from "./simulatorFullResponse";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Matches the run-status model in admin-monitor-check-runs.ts, itself adapted
// from msp-diagnostics' real pending → running → completed/failed lifecycle.
type RunStatus = "pending" | "running" | "completed" | "failed";

interface CheckRun {
  runId: string;
  checkKey: string;
  status: RunStatus;
  statusText: string;
  progress: number;
  result?: {
    checkKey: string;
    status: string;
    extractedProperties: Record<string, unknown>;
    severityMatched: string | null;
    errorMessage?: string;
    itemCount: number;
    pageCount: number;
  };
  error?: string;
  request: { endpoint: string; method: string; requestBody: unknown };
}

export interface MonitorCheckSummary {
  key: string;
  label: string;
  description: string | null;
  endpoint: string;
  method: string;
  selectParams: string | null;
  requestBody: Record<string, unknown> | null;
  properties: string[];
  mapping: Array<{ sourceField: string; targetField: string; transform?: string }>;
  requiresCustomerScript: boolean;
  status: string;
}

const RUN_POLL_INTERVAL_MS = 1000;
// ~2 minutes. A single Graph check that hasn't finished by then is stuck, and a
// bounded poll is the same discipline the suite-run poller in the tree uses.
const RUN_POLL_MAX_TICKS = 120;

export function SimulatorEndpointCanvas({ check }: { check: MonitorCheckSummary }) {
  const { fetchWithAuth } = useAuth();
  const { selectedCustomerId } = useTestbedContext();

  // Editable request fields, pre-filled from the check's own stored config.
  const [endpoint, setEndpoint] = useState(check.endpoint);
  const [method, setMethod] = useState(check.method || "GET");
  const [selectParams, setSelectParams] = useState(check.selectParams ?? "");
  const [requestBodyText, setRequestBodyText] = useState(
    check.requestBody ? JSON.stringify(check.requestBody, null, 2) : "",
  );

  const [run, setRun] = useState<CheckRun | null>(null);
  // The server's classification of THIS run's failure. Null whenever the run
  // succeeded (or hasn't failed yet), so the banner can never sit over a green run.
  const [classification, setClassification] = useState<FailureClassification | null>(null);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  // Bumped whenever a run reaches a terminal state, so the persisted history
  // list refetches instead of showing a stale set.
  const [historyToken, setHistoryToken] = useState(0);
  const pollRef = useRef<number | null>(null);
  const engineTraceRef = useRef<SimulatorEngineTraceHandle | null>(null);

  // FULL RESPONSE MODE (Part A) — per-run only. Toggling this NEVER mutates
  // `selectParams`/the stored check: it only changes what handleRun sends as
  // its endpoint override. See simulatorFullResponse.ts for why $select must be
  // stripped from BOTH the dedicated selectParams field and any $select baked
  // directly into `endpoint` (real seeded checks do both).
  const [fullResponse, setFullResponse] = useState(false);
  // The raw, unmapped items Graph returned for the run currently shown — only
  // populated after a Full Response run, fetched via the dedicated
  // GET .../items route (the poll response deliberately omits items).
  const [rawItems, setRawItems] = useState<unknown[] | null>(null);
  const [rawItemsError, setRawItemsError] = useState<string | null>(null);
  const [loadingRawItems, setLoadingRawItems] = useState(false);

  // Tie-to-action targets: "Edit endpoint" focuses the real field in the form
  // already on this page. It opens and selects — it never saves.
  const endpointRef = useRef<HTMLInputElement | null>(null);
  const selectParamsRef = useRef<HTMLInputElement | null>(null);
  const requestBodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Re-seed every field when a different endpoint is selected in the tree.
  useEffect(() => {
    setEndpoint(check.endpoint);
    setMethod(check.method || "GET");
    setSelectParams(check.selectParams ?? "");
    setRequestBodyText(check.requestBody ? JSON.stringify(check.requestBody, null, 2) : "");
    setRun(null);
    setClassification(null);
    setFullResponse(false);
    setRawItems(null);
    setRawItemsError(null);
  }, [check.key]);

  /** Opens the edit form on the field the classification points at. Never saves. */
  const focusRequestField = (field: "endpoint" | "selectParams" | "requestBody") => {
    const el =
      field === "selectParams" ? selectParamsRef.current
      : field === "requestBody" ? requestBodyRef.current
      : endpointRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus();
    el.select();
  };

  useEffect(() => {
    return () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current);
    };
  }, []);

  const isRunning = run?.status === "pending" || run?.status === "running" || starting;

  // select_params is stored separately from the endpoint, so the URL the operator
  // reads has to show them joined the way the request will actually go out —
  // otherwise the "real URL" shown is not the real URL.
  const effectiveEndpoint = useMemo(() => {
    const trimmed = selectParams.trim();
    if (!trimmed) return endpoint;
    const sep = endpoint.includes("?") ? "&" : "?";
    return `${endpoint}${sep}${trimmed.replace(/^[?&]/, "")}`;
  }, [endpoint, selectParams]);

  // FULL RESPONSE (Part A) — omits $select for this one execution ONLY. Strips
  // it from the effective URL right before it becomes the run's endpoint
  // override; `endpoint`/`selectParams` state (and what Save/PATCH persists)
  // are untouched either way.
  const runEndpoint = useMemo(
    () => (fullResponse ? stripSelectParam(effectiveEndpoint) : effectiveEndpoint),
    [fullResponse, effectiveEndpoint],
  );

  const fullUrl = runEndpoint.startsWith("http")
    ? runEndpoint
    : `${GRAPH_BASE}${runEndpoint.startsWith("/") ? "" : "/"}${runEndpoint}`;

  const parsedBody = useMemo(() => {
    if (!requestBodyText.trim()) return { ok: true as const, value: null };
    try {
      return { ok: true as const, value: JSON.parse(requestBodyText) as unknown };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "Invalid JSON" };
    }
  }, [requestBodyText]);

  const resetToStored = () => {
    setEndpoint(check.endpoint);
    setMethod(check.method || "GET");
    setSelectParams(check.selectParams ?? "");
    setRequestBodyText(check.requestBody ? JSON.stringify(check.requestBody, null, 2) : "");
  };

  const stopPolling = () => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  /** Fetches the raw captured items for a completed run — the dedicated Full
   *  Response read, since the poll response deliberately omits `items`. */
  const loadRawItems = async (runId: string) => {
    setLoadingRawItems(true);
    setRawItemsError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/monitor-check-runs/${runId}/items`);
      const data = await res.json();
      if (!res.ok) {
        setRawItemsError(data.error || "Failed to load the full captured response");
        setRawItems(null);
        return;
      }
      setRawItems(data.items as unknown[]);
    } catch (err: any) {
      setRawItemsError(err.message || "Network error loading the full captured response");
      setRawItems(null);
    } finally {
      setLoadingRawItems(false);
    }
  };

  const handleRun = async () => {
    if (isRunning) return;
    if (selectedCustomerId == null) {
      toast.error("Select a testbed customer in the header first");
      return;
    }
    if (!parsedBody.ok) {
      toast.error(`Request body is not valid JSON: ${parsedBody.message}`);
      return;
    }

    // Captured at run start so a mid-run toggle of Full Response can't change
    // which response this particular run's completion fetches items for.
    const thisRunIsFullResponse = fullResponse;

    setStarting(true);
    setRun(null);
    setClassification(null);
    setRawItems(null);
    setRawItemsError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/monitor-checks/${encodeURIComponent(check.key)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomerId,
          endpoint: runEndpoint,
          method,
          requestBody: parsedBody.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to start run");
        return;
      }
      setRun(data.run as CheckRun);

      const runId: string = data.runId;
      let ticks = 0;
      let inFlight = false;
      stopPolling();
      // Same guard shape the suite-run poller uses: skip a tick while a poll is
      // still pending, but always count it so a hung request can't outlive the cap.
      pollRef.current = window.setInterval(async () => {
        ticks += 1;
        if (!inFlight) {
          inFlight = true;
          try {
            const pollRes = await fetchWithAuth(`/api/admin/monitor-check-runs/${runId}`);
            if (pollRes.ok) {
              const pollData = await pollRes.json();
              const current = pollData.run as CheckRun;
              setRun(current);
              // Computed server-side from this run's real error text; null unless
              // the run actually failed.
              setClassification((pollData.classification ?? null) as FailureClassification | null);
              if (current.status === "completed" || current.status === "failed") {
                stopPolling();
                // The run is now a persisted row — refresh history so it appears.
                setHistoryToken((t) => t + 1);
                if (current.status === "completed") {
                  toast.success(`${check.key} completed`);
                  if (thisRunIsFullResponse) void loadRawItems(runId);
                } else {
                  toast.error(current.statusText || "Run failed");
                }
                return;
              }
            }
          } catch {
            // Transient poll error — keep polling until the tick budget runs out.
          } finally {
            inFlight = false;
          }
        }
        if (ticks >= RUN_POLL_MAX_TICKS) {
          stopPolling();
          toast.error("Run is still going after 2 minutes — stopped polling");
        }
      }, RUN_POLL_INTERVAL_MS);
    } catch (err: any) {
      toast.error(err.message || "Network error starting run");
    } finally {
      setStarting(false);
    }
  };

  // Loads a PERSISTED past run back into the canvas — response, status and the
  // engine trace below it, all keyed off the stored runId. This is only possible
  // because runs outlive the process now; the trace route reads that run's own
  // stored response, so re-evaluating it still issues no Graph request.
  const handleOpenRun = async (runId: string) => {
    stopPolling();
    setRawItems(null);
    setRawItemsError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/monitor-check-runs/${runId}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to load that run");
        return;
      }
      setRun(data.run as CheckRun);
      // A historical failure is triaged the same way a live one is — the
      // classification is recomputed from that run's own stored error text, so
      // opening a run from before this phase existed still gets a verdict.
      setClassification((data.classification ?? null) as FailureClassification | null);
    } catch (err: any) {
      toast.error(err.message || "Network error loading that run");
    }
  };

  const handleSave = async () => {
    if (!parsedBody.ok) {
      toast.error(`Request body is not valid JSON: ${parsedBody.message}`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/monitor-checks/${encodeURIComponent(check.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint,
          method,
          selectParams: selectParams.trim() ? selectParams.trim() : null,
          requestBody: parsedBody.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to save changes");
        return;
      }
      toast.success("Endpoint saved");
      window.dispatchEvent(new CustomEvent("simulator-endpoints-updated"));
    } catch (err: any) {
      toast.error(err.message || "Network error saving endpoint");
    } finally {
      setSaving(false);
    }
  };

  const handleRetire = async () => {
    if (!confirm(`Retire "${check.key}"? It stays in the catalog with status "archived" and can be reactivated.`)) return;
    try {
      // DELETE on the existing CRUD route is already a reversible status change
      // to "archived" — the real enum value — never a hard delete.
      const res = await fetchWithAuth(`/api/admin/monitor-checks/${encodeURIComponent(check.key)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to retire endpoint");
        return;
      }
      toast.success("Endpoint retired (archived — reversible)");
      window.dispatchEvent(new CustomEvent("simulator-endpoints-updated"));
    } catch (err: any) {
      toast.error(err.message || "Network error retiring endpoint");
    }
  };

  const handleReactivate = async () => {
    try {
      const res = await fetchWithAuth(`/api/admin/monitor-checks/${encodeURIComponent(check.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to reactivate endpoint");
        return;
      }
      toast.success("Endpoint reactivated");
      window.dispatchEvent(new CustomEvent("simulator-endpoints-updated"));
    } catch (err: any) {
      toast.error(err.message || "Network error reactivating endpoint");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background p-4">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-mono text-sm font-semibold text-foreground">{check.key}</h3>
            {check.status !== "active" && (
              <span className="rounded-sm border border-amber-400/40 bg-amber-400/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-400">
                {check.status}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{check.description || check.label}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={resetToStored}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Reset fields to the stored config"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Persist these fields to the catalog row"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
          </button>
          {check.status === "active" ? (
            <button
              onClick={handleRetire}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
              title="Retire (archive) — reversible, never deletes the row"
            >
              <Archive className="h-3 w-3" /> Retire
            </button>
          ) : (
            <button
              onClick={handleReactivate}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Set status back to active"
            >
              <RotateCcw className="h-3 w-3" /> Reactivate
            </button>
          )}
          <label
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="This Run only — requests every field this endpoint returns by omitting $select. Never changes the check's stored select_params/properties, and never affects scheduled production scans."
          >
            <input
              type="checkbox"
              checked={fullResponse}
              onChange={(e) => setFullResponse(e.target.checked)}
              className="h-3 w-3"
            />
            Full Response
          </label>
          <button
            onClick={handleRun}
            disabled={isRunning || check.requiresCustomerScript}
            className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            title={
              check.requiresCustomerScript
                ? "This check runs via a customer-side script — there is no Graph request to issue"
                : "Run this endpoint against the selected tenant"
            }
          >
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 fill-current" />}
            Run
          </button>
        </div>
      </div>

      {fullResponse && (
        <div className="mb-3 rounded border border-primary/40 bg-primary/10 px-3 py-2 text-[11px] text-primary">
          Full Response is ON for the next run only — $select is stripped from the request below (other params like
          $filter/$expand are kept). This never saves to the check's config and never applies to scheduled scans.
        </div>
      )}

      {check.requiresCustomerScript && (
        <div className="mb-3 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300">
          This check is collected by a customer-side PowerShell script, not a Graph request — it can't be executed here.
        </div>
      )}

      {/* Real resolved URL */}
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Request URL
      </label>
      <div className="mb-3 flex items-stretch gap-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:border-ring focus:outline-none"
        >
          {["GET", "POST", "PATCH", "PUT", "DELETE"].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          ref={endpointRef}
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          spellCheck={false}
          className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:border-ring focus:outline-none"
        />
      </div>
      <div className="mb-3 break-all rounded border border-border bg-card px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
        {fullUrl}
      </div>

      {/* Parameters */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Select params
          </label>
          <input
            ref={selectParamsRef}
            value={selectParams}
            onChange={(e) => setSelectParams(e.target.value)}
            spellCheck={false}
            placeholder="$select=id,displayName"
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:border-ring focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Extracted properties
          </label>
          <div className="min-h-[26px] rounded border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {check.properties.length > 0 ? check.properties.join(", ") : "—"}
          </div>
        </div>
      </div>

      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Request body {method === "GET" && <span className="normal-case text-muted-foreground/60">(unused for GET)</span>}
      </label>
      <textarea
        ref={requestBodyRef}
        value={requestBodyText}
        onChange={(e) => setRequestBodyText(e.target.value)}
        spellCheck={false}
        rows={4}
        placeholder="{}"
        className={`mb-1 w-full resize-y rounded border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:outline-none ${
          parsedBody.ok ? "border-border focus:border-ring" : "border-destructive"
        }`}
      />
      {!parsedBody.ok && <p className="mb-2 text-[10px] text-destructive">Invalid JSON: {parsedBody.message}</p>}

      {/* Live progress + status */}
      {run && (
        <div className="mb-3 mt-2">
          <div className="mb-1 flex items-center justify-between text-[10px]">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">Run status</span>
            <span
              className={`font-mono ${
                run.status === "completed"
                  ? "text-emerald-400"
                  : run.status === "failed"
                    ? "text-destructive"
                    : "text-primary"
              }`}
            >
              {run.status}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-accent">
            <div
              className={`h-full transition-all ${
                run.status === "failed" ? "bg-destructive" : run.status === "completed" ? "bg-emerald-400" : "bg-primary"
              }`}
              style={{ width: `${run.progress}%` }}
            />
          </div>
          <p className="mt-1 break-words text-[11px] text-muted-foreground">{run.statusText}</p>
          {run.result && (
            <div className="mt-1 flex flex-wrap gap-3 text-[10px] font-mono text-muted-foreground">
              <span>status: {run.result.status}</span>
              <span>items: {run.result.itemCount}</span>
              <span>pages: {run.result.pageCount}</span>
              <span>severity: {run.result.severityMatched ?? "none"}</span>
            </div>
          )}
        </div>
      )}

      {/* Failure triage — FIRST thing on a failure, above the response. Every
          action it offers opens a reviewable form or a confirmed, reversible
          archive; none of them applies a change on click. */}
      {classification && (
        <SimulatorFailureClassification
          classification={classification}
          onEditEndpoint={focusRequestField}
          onRetire={() => void handleRetire()}
          canRetire={check.status === "active"}
        />
      )}

      {/* Response */}
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Response
        </label>
        {run?.status === "completed" && (
          <button
            onClick={() => void loadRawItems(run.runId)}
            disabled={loadingRawItems}
            className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Load the full, unmapped items this run actually captured — every field Graph returned, not just this check's configured properties"
          >
            {loadingRawItems ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            View full response
          </button>
        )}
      </div>
      <JsonResponseViewer
        value={rawItems ?? run?.result ?? (run?.error ? { error: run.error } : undefined)}
        emptyLabel="Run this endpoint to see the real tenant response"
        className="min-h-[160px]"
      />
      {rawItemsError && <p className="mt-1 text-[10px] text-destructive">{rawItemsError}</p>}

      {/* Property picker — pick ANY real field the full response returned and
          jump straight into a pre-filled rule draft, reusing the trace route's
          suggestion pipeline (SimulatorEngineTrace.suggestRuleForProperty) —
          the same inferSuggestion() Phase 2 built, not a second version. */}
      {rawItems && rawItems.length > 0 && (
        <div className="mt-2 rounded border border-border bg-card p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Lightbulb className="h-3 w-3" />
            Build a rule from a returned field
          </div>
          <div className="flex flex-wrap gap-1">
            {Object.keys(rawItems[0] as Record<string, unknown>)
              .filter((k) => !check.properties.includes(k))
              .map((k) => (
                <button
                  key={k}
                  onClick={() => void engineTraceRef.current?.suggestRuleForProperty(k)}
                  className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  title={`Suggest a signal_derivation_rules row for "${k}" — opens an editable draft, nothing is created until you save`}
                >
                  {k}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Engine trace — response -> mapping -> profile keys -> rules -> fired?
          "Re-run" is wired to the same handleRun the header's Run button uses,
          so the live-tenant path is one code path, not two. */}
      <SimulatorEngineTrace
        ref={engineTraceRef}
        runId={run?.runId ?? null}
        checkKey={check.key}
        runStatus={run?.status ?? null}
        onRerun={() => void handleRun()}
        rerunning={isRunning}
        checkProperties={check.properties}
      />

      {/* Persisted run history for this endpoint, and the two-run diff. */}
      <SimulatorRunHistory
        checkKey={check.key}
        customerId={selectedCustomerId ?? null}
        refreshToken={historyToken}
        onOpenRun={(runId) => void handleOpenRun(runId)}
      />
    </div>
  );
}
