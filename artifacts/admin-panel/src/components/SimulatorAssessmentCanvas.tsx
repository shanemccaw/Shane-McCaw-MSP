// artifacts/admin-panel/src/components/SimulatorAssessmentCanvas.tsx
//
// Center view for the Simulator Studio's "Assessments" node. Phase 1 (Issue
// #23) built the read-only shell — header, metadata, real stored config,
// resolved packageKey + package check list. Phase 2 (Issue #24) adds
// execution: a "Run" button against the selected testbed customer, wired to
// the EXISTING diagnostics pipeline (no new backend) —
// POST /api/msp/customers/:customerId/diagnostics/run followed by
// GET /api/msp/customers/:customerId/diagnostics/runs/:runId/sse, the exact
// same two calls SimulatorEndpointCanvas-adjacent live surfaces
// (useAssessmentLiveStatus.ts) already use for the same events
// (diagnostics_progress / diagnostics_complete / diagnostics_error).
// packageKey is sent only when this assessment has a dedicated one
// (assessment.packageKey) — the 15 assessments still on the
// core:security-baseline fallback omit it entirely, letting the run route's
// own default resolution apply, exactly like the "default"/empty-string
// no-op the route already treats as "not provided".
//
// Deliberately NOT here (later phases, not yet built): a findings table or
// run history — this phase's "results" surface is just the completion
// summary banner. create/edit/delete of the packageKey assignment or of
// monitoring packages themselves stays out of scope too.

import { useEffect, useRef, useState } from "react";
import { ListChecks, AlertTriangle, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import type { AssessmentNode } from "./SimulatorLeftTree";

// Discriminated union matching the real events broadcastDiagnosticsRun*
// emits on channel "engine.monitor" (api-server lib/sse-channels.ts).
type DiagnosticsSSEEvent =
  | { type: "diagnostics_progress"; checkKey: string; checkLabel: string; status: string; index: number; total: number }
  | {
      type: "diagnostics_complete";
      status: string;
      checksTotal: number;
      checksOk: number;
      checksError: number;
      requiresScript: number;
      findings: number;
    }
  | { type: "diagnostics_error"; message: string };

interface ProgressEntry {
  checkKey: string;
  checkLabel: string;
  status: string;
}

type RunPhase = "idle" | "starting" | "running" | "complete" | "error";

interface RunSummary {
  status: string;
  checksTotal: number;
  checksOk: number;
  checksError: number;
  requiresScript: number;
  findings: number;
}

export function SimulatorAssessmentCanvas({ assessment }: { assessment: AssessmentNode }) {
  const { fetchWithAuth, accessToken } = useAuth();
  const { selectedCustomerId } = useTestbedContext();

  const [phase, setPhase] = useState<RunPhase>("idle");
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const [log, setLog] = useState<ProgressEntry[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Re-seed whenever a different assessment is selected in the tree.
  useEffect(() => {
    esRef.current?.close();
    esRef.current = null;
    setPhase("idle");
    setProgress(null);
    setLog([]);
    setSummary(null);
    setErrorMessage(null);
  }, [assessment.id]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  const handleRun = async () => {
    if (phase === "starting" || phase === "running") return;
    if (selectedCustomerId == null) {
      toast.error("Select a testbed customer in the header first");
      return;
    }

    setPhase("starting");
    setProgress(null);
    setLog([]);
    setSummary(null);
    setErrorMessage(null);

    try {
      const res = await fetchWithAuth(`/api/msp/customers/${selectedCustomerId}/diagnostics/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Dedicated-package assessments send the real packageKey; the 15
        // still on the fallback send undefined so the route resolves its own
        // default instead of this canvas hardcoding core:security-baseline.
        body: JSON.stringify(assessment.packageKey ? { packageKey: assessment.packageKey } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to start run");
        setPhase("idle");
        return;
      }

      const runId: string = data.runId;
      setPhase("running");

      if (!accessToken) {
        toast.error("Missing auth token — cannot open live progress stream");
        setPhase("idle");
        return;
      }

      const es = new EventSource(
        `/api/msp/customers/${selectedCustomerId}/diagnostics/runs/${runId}/sse?jwt=${encodeURIComponent(accessToken)}`,
      );
      esRef.current = es;
      es.onmessage = (event) => {
        const parsed = JSON.parse(event.data) as DiagnosticsSSEEvent;
        if (parsed.type === "diagnostics_progress") {
          setProgress({ index: parsed.index, total: parsed.total });
          setLog((prev) => [...prev, { checkKey: parsed.checkKey, checkLabel: parsed.checkLabel, status: parsed.status }]);
        } else if (parsed.type === "diagnostics_complete") {
          es.close();
          esRef.current = null;
          setPhase("complete");
          setSummary({
            status: parsed.status,
            checksTotal: parsed.checksTotal,
            checksOk: parsed.checksOk,
            checksError: parsed.checksError,
            requiresScript: parsed.requiresScript,
            findings: parsed.findings,
          });
          toast.success(`${assessment.name} run complete`);
        } else if (parsed.type === "diagnostics_error") {
          es.close();
          esRef.current = null;
          setPhase("error");
          setErrorMessage(parsed.message);
          toast.error(parsed.message || "Run failed");
        }
      };
      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (phase !== "complete") {
          setPhase("error");
          setErrorMessage((prev) => prev ?? "Live progress stream disconnected");
        }
      };
    } catch (err: any) {
      toast.error(err.message || "Network error starting run");
      setPhase("idle");
    }
  };

  const isRunning = phase === "starting" || phase === "running";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background p-4">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">{assessment.name}</h3>
            <span
              className={`rounded-sm border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider ${
                assessment.isFreeOffering
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-400"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              {assessment.isFreeOffering ? "Free" : "Paid"}
            </span>
          </div>
          {assessment.slug && <p className="mt-0.5 font-mono text-xs text-muted-foreground">{assessment.slug}</p>}
        </div>
        <button
          onClick={() => void handleRun()}
          disabled={isRunning || selectedCustomerId == null}
          className="flex shrink-0 items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          title={selectedCustomerId == null ? "Select a testbed customer first" : "Run this assessment against the selected tenant"}
        >
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 fill-current" />}
          Run
        </button>
      </div>

      {/* Live progress + status */}
      {(isRunning || phase === "complete" || phase === "error") && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-[10px]">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">Run status</span>
            <span
              className={`font-mono ${
                phase === "complete" ? "text-emerald-400" : phase === "error" ? "text-destructive" : "text-primary"
              }`}
            >
              {phase}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-accent">
            <div
              className={`h-full transition-all ${phase === "error" ? "bg-destructive" : phase === "complete" ? "bg-emerald-400" : "bg-primary"}`}
              style={{
                width:
                  phase === "complete"
                    ? "100%"
                    : progress && progress.total > 0
                      ? `${Math.round((progress.index / progress.total) * 100)}%`
                      : "5%",
              }}
            />
          </div>
          {progress && phase === "running" && (
            <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
              {progress.index}/{progress.total} checks
            </p>
          )}

          {log.length > 0 && (
            <div className="mt-2 max-h-32 space-y-0.5 overflow-y-auto rounded border border-border bg-card px-2 py-1.5">
              {log.map((entry, i) => (
                <div key={`${entry.checkKey}-${i}`} className="flex items-center gap-2 font-mono text-[10px]">
                  <span className="text-muted-foreground/60">{entry.status}</span>
                  <span className="truncate text-muted-foreground">{entry.checkLabel}</span>
                </div>
              ))}
            </div>
          )}

          {phase === "error" && errorMessage && (
            <p className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
              {errorMessage}
            </p>
          )}

          {phase === "complete" && summary && (
            <div className="mt-2 rounded border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-300">
              <div className="mb-1 font-semibold uppercase tracking-wider">Run complete — {summary.status}</div>
              <div className="flex flex-wrap gap-3 font-mono text-[10px] text-emerald-300/90">
                <span>checks: {summary.checksTotal}</span>
                <span>ok: {summary.checksOk}</span>
                <span>errors: {summary.checksError}</span>
                <span>requires script: {summary.requiresScript}</span>
                <span>findings: {summary.findings}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Metadata */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Service ID
          </label>
          <div className="rounded border border-border bg-card px-2 py-1 font-mono text-[11px] text-foreground">
            {assessment.id}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Resolved packageKey
          </label>
          <div className="rounded border border-border bg-card px-2 py-1 font-mono text-[11px] text-foreground">
            {assessment.packageKey ?? "—"}
          </div>
        </div>
      </div>

      {/* No dedicated package — the fallback state */}
      {!assessment.hasDedicatedPackage && (
        <div className="mb-3 flex items-start gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            No package assigned — running on the <span className="font-mono">core:security-baseline</span> fallback
            (the same default <span className="font-mono">consent.ts</span> resolves to when a purchased
            assessment's product carries no dedicated packageKey).
          </span>
        </div>
      )}

      {/* Dedicated package's check list */}
      {assessment.hasDedicatedPackage && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Package checks
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground/70">
              {assessment.checkCount ?? 0} check{(assessment.checkCount ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
          {assessment.checkKeys && assessment.checkKeys.length > 0 ? (
            <ol className="space-y-1">
              {assessment.checkKeys.map((key, i) => (
                <li
                  key={`${key}-${i}`}
                  className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1"
                >
                  <ListChecks className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="text-[10px] tabular-nums text-muted-foreground/60">{i + 1}</span>
                  <span className="font-mono text-[11px] text-foreground">{key}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="rounded border border-border bg-card px-3 py-2 text-[11px] italic text-muted-foreground">
              This package has no checks configured yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
