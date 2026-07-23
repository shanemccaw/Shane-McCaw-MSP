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
// Deliberately NOT here (later phases, per the sequenced spec): engine-trace
// integration, bulk run, run history/diff, auto-classification, write endpoints.
//
// Editing a parameter here does NOT mutate the catalog row — the run route takes
// per-run overrides. Persisting a change is the explicit "Save changes" action,
// which PATCHes the existing /api/admin/monitor-checks/:key CRUD route.

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, Save, Archive, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import { JsonResponseViewer } from "./JsonResponseViewer";

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
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<number | null>(null);

  // Re-seed every field when a different endpoint is selected in the tree.
  useEffect(() => {
    setEndpoint(check.endpoint);
    setMethod(check.method || "GET");
    setSelectParams(check.selectParams ?? "");
    setRequestBodyText(check.requestBody ? JSON.stringify(check.requestBody, null, 2) : "");
    setRun(null);
  }, [check.key]);

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

  const fullUrl = effectiveEndpoint.startsWith("http")
    ? effectiveEndpoint
    : `${GRAPH_BASE}${effectiveEndpoint.startsWith("/") ? "" : "/"}${effectiveEndpoint}`;

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

    setStarting(true);
    setRun(null);
    try {
      const res = await fetchWithAuth(`/api/admin/monitor-checks/${encodeURIComponent(check.key)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomerId,
          endpoint: effectiveEndpoint,
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
              if (current.status === "completed" || current.status === "failed") {
                stopPolling();
                if (current.status === "completed") toast.success(`${check.key} completed`);
                else toast.error(current.statusText || "Run failed");
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

      {/* Response */}
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Response
      </label>
      <JsonResponseViewer
        value={run?.result ?? (run?.error ? { error: run.error } : undefined)}
        emptyLabel="Run this endpoint to see the real tenant response"
        className="min-h-[160px]"
      />
    </div>
  );
}
