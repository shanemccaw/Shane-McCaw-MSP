// artifacts/admin-panel/src/components/SimulatorAssessmentCanvas.tsx
//
// Center view for the Simulator Studio's "Assessments" node. Phase 1 (Issue
// #23) built the read-only shell — header, metadata, real stored config,
// resolved packageKey + package check list. Phase 2 (Issue #24) added
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
// Phase 3 (Issue #25) adds results/findings display. No new backend: reuses
// the existing GET /api/msp/customers/:customerId/diagnostics/runs/:runId
// (returns { run, findings }, msp-diagnostics.ts) and, for viewing a run
// picked outside the live-run flow, GET .../diagnostics/runs (plain array,
// most recent first — the same route customer-detail.tsx's Diagnostics tab
// uses for its run-history list). That route orders findings alphabetically
// by severity text ("critical, info, ok, warning"), which is not a usable
// priority order — re-sorted client-side by SEVERITY_PRIORITY instead of
// touching the shared backend route. Severity colors/labels and the
// findings-row shape mirror customer-detail.tsx's SEVERITY_CONFIG/
// DiagnosticFinding (same msp_diagnostic_findings rows, same 4-value enum).
// extractedProperties renders via the existing JsonResponseViewer
// (Formatted/Raw tabs + copy) rather than a second JSON viewer.
//
// Phase 4 (Issue #26) adds run history + diff, in a sibling component
// (SimulatorAssessmentRunHistory.tsx, wired in at the bottom of this canvas)
// rather than growing this already-large file further. No new backend
// either: the history list reuses the SAME GET .../diagnostics/runs route
// as the past-run picker above (filtered client-side to this assessment's
// resolved packageKey, since the shared route has no server-side packageKey
// filter), and the diff is NEW client-side logic — categorizing the two
// selected runs' findings arrays (each fetched via the existing
// GET .../diagnostics/runs/:runId route) into new/resolved/severity-changed/
// unchanged. This is NOT the same diff as SimulatorRunHistory.tsx's (that
// one is server-computed against simulator_check_runs, a different table
// entirely) — only its checkbox-select-two / Diff-button / DiffView
// interaction pattern is mirrored here.

import { Fragment, useEffect, useRef, useState } from "react";
import { ListChecks, AlertTriangle, AlertCircle, Info, CheckCircle2, ChevronDown, ChevronRight, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import { JsonResponseViewer } from "./JsonResponseViewer";
import { SimulatorAssessmentRunHistory } from "./SimulatorAssessmentRunHistory";
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

// Matches msp_diagnostic_findings (msp.ts) — same rows customer-detail.tsx's
// DiagnosticsTab renders, same 4-value severity enum. Exported for reuse by
// SimulatorAssessmentRunHistory.tsx's client-side diff (Phase 4, #26).
export interface DiagnosticFinding {
  findingId: string;
  checkKey: string;
  checkLabel: string;
  severity: "ok" | "info" | "warning" | "critical";
  title: string;
  description?: string | null;
  extractedProperties?: Record<string, unknown> | null;
  checkStatus?: string | null;
}

// A row from GET .../diagnostics/runs (plain array, most recent first) — the
// minimal past-run picker for this phase, not full history browsing (#26).
interface PastRun {
  runId: string;
  status: string;
  packageKey: string;
  checksTotal: number;
  createdAt: string;
  completedAt?: string | null;
}

// The API orders findings alphabetically by severity text ("critical, info,
// ok, warning") — not a usable priority order. Re-sort client-side instead
// of touching the shared backend route.
export const SEVERITY_PRIORITY: Record<DiagnosticFinding["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
  ok: 3,
};

function sortFindingsBySeverity(findings: DiagnosticFinding[]): DiagnosticFinding[] {
  return [...findings].sort((a, b) => SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity]);
}

// Same color/label convention as customer-detail.tsx's SEVERITY_CONFIG for
// this exact 4-value enum — reused here rather than inventing new colors.
const SEVERITY_CONFIG = {
  critical: { label: "Critical", icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" },
  warning: { label: "Warning", icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
  info: { label: "Info", icon: Info, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30" },
  ok: { label: "OK", icon: CheckCircle2, color: "text-green-400", bg: "bg-green-500/10 border-green-500/30" },
} as const;

function SeverityBadge({ severity }: { severity: DiagnosticFinding["severity"] }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <span
      className={`rounded-sm border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider ${cfg.bg} ${cfg.color}`}
    >
      {cfg.label}
    </span>
  );
}

function relativeDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (diff < 1) return "Just now";
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  const days = Math.floor(diff / 1440);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

  // Findings for whichever run is currently being viewed — either the run
  // that just completed via the live SSE flow above, or one picked from the
  // past-runs dropdown below.
  const [findingsRunId, setFindingsRunId] = useState<string | null>(null);
  const [findings, setFindings] = useState<DiagnosticFinding[] | null>(null);
  const [loadingFindings, setLoadingFindings] = useState(false);
  const [findingsError, setFindingsError] = useState<string | null>(null);
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(null);

  // Minimal recent-runs picker so results are viewable for a run selected
  // outside the live-run flow. Full history/diff is Phase 4 (#26).
  const [pastRuns, setPastRuns] = useState<PastRun[]>([]);
  const [loadingPastRuns, setLoadingPastRuns] = useState(false);

  // Re-seed whenever a different assessment is selected in the tree.
  useEffect(() => {
    esRef.current?.close();
    esRef.current = null;
    setPhase("idle");
    setProgress(null);
    setLog([]);
    setSummary(null);
    setErrorMessage(null);
    setFindingsRunId(null);
    setFindings(null);
    setFindingsError(null);
    setExpandedFindingId(null);
  }, [assessment.id]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  const loadPastRuns = async () => {
    if (selectedCustomerId == null) {
      setPastRuns([]);
      return;
    }
    setLoadingPastRuns(true);
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${selectedCustomerId}/diagnostics/runs?limit=10`);
      if (!res.ok) {
        setPastRuns([]);
        return;
      }
      const data = await res.json();
      setPastRuns(Array.isArray(data) ? data : []);
    } catch {
      setPastRuns([]);
    } finally {
      setLoadingPastRuns(false);
    }
  };

  // Reload the picker whenever the testbed customer or selected assessment
  // changes — the dropdown always reflects that customer's recent runs.
  useEffect(() => {
    void loadPastRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomerId, assessment.id]);

  const loadFindings = async (runId: string) => {
    if (selectedCustomerId == null) return;
    setFindingsRunId(runId);
    setLoadingFindings(true);
    setFindingsError(null);
    setExpandedFindingId(null);
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${selectedCustomerId}/diagnostics/runs/${runId}`);
      const data = await res.json();
      if (!res.ok) {
        setFindingsError(data.error || "Failed to load findings for this run");
        setFindings(null);
        return;
      }
      setFindings(sortFindingsBySeverity((data.findings ?? []) as DiagnosticFinding[]));
    } catch (err: any) {
      setFindingsError(err.message || "Network error loading findings");
      setFindings(null);
    } finally {
      setLoadingFindings(false);
    }
  };

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
    setFindingsRunId(null);
    setFindings(null);
    setFindingsError(null);
    setExpandedFindingId(null);

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
          void loadFindings(runId);
          void loadPastRuns();
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

      {/* Past runs — minimal picker so results are viewable for a run
          selected outside the live-run flow above. Full history/diff
          browsing is Phase 4 (#26). */}
      <div className="mb-3 flex items-center gap-2">
        <label className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          View run
        </label>
        <select
          className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1 font-mono text-[11px] text-foreground disabled:opacity-50"
          disabled={loadingPastRuns || pastRuns.length === 0 || selectedCustomerId == null}
          value={findingsRunId ?? ""}
          onChange={(e) => {
            if (e.target.value) void loadFindings(e.target.value);
          }}
        >
          <option value="" disabled>
            {selectedCustomerId == null
              ? "Select a testbed customer first"
              : loadingPastRuns
                ? "Loading recent runs…"
                : pastRuns.length === 0
                  ? "No runs yet for this customer"
                  : "Select a past run…"}
          </option>
          {pastRuns.map((run) => (
            <option key={run.runId} value={run.runId}>
              {run.status} · {relativeDate(run.createdAt)} · {run.checksTotal} checks · {run.packageKey}
            </option>
          ))}
        </select>
      </div>

      {/* Findings table */}
      {(loadingFindings || findingsError || findings !== null) && (
        <div className="mb-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Findings{findingsRunId ? ` — run ${findingsRunId.slice(0, 8)}` : ""}
            </span>
            {findings && (
              <span className="text-[10px] tabular-nums text-muted-foreground/70">
                {findings.length} finding{findings.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {loadingFindings && (
            <div className="flex items-center gap-2 rounded border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading findings…
            </div>
          )}

          {!loadingFindings && findingsError && (
            <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {findingsError}
            </p>
          )}

          {!loadingFindings && !findingsError && findings && findings.length === 0 && (
            <div className="rounded border border-border bg-card px-3 py-2 text-[11px] italic text-muted-foreground">
              No findings for this run.
            </div>
          )}

          {!loadingFindings && !findingsError && findings && findings.length > 0 && (
            <div className="overflow-hidden rounded border border-border">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-border bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-20 px-2 py-1.5 text-left font-semibold">Severity</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Check</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Finding</th>
                    <th className="w-6 px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {findings.map((finding) => {
                    const isExpanded = expandedFindingId === finding.findingId;
                    return (
                      <Fragment key={finding.findingId}>
                        <tr
                          className="cursor-pointer border-b border-border bg-background last:border-b-0 hover:bg-accent/40"
                          onClick={() => setExpandedFindingId(isExpanded ? null : finding.findingId)}
                        >
                          <td className="px-2 py-1.5 align-top">
                            <SeverityBadge severity={finding.severity} />
                          </td>
                          <td className="px-2 py-1.5 align-top font-mono text-muted-foreground">
                            {finding.checkLabel || finding.checkKey}
                          </td>
                          <td className="px-2 py-1.5 align-top text-foreground">{finding.title}</td>
                          <td className="px-2 py-1.5 align-top text-muted-foreground">
                            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-border bg-card last:border-b-0">
                            <td colSpan={4} className="px-2 py-2">
                              {finding.description && (
                                <p className="mb-2 text-[11px] text-muted-foreground">{finding.description}</p>
                              )}
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Extracted properties
                              </div>
                              <JsonResponseViewer
                                value={finding.extractedProperties ?? undefined}
                                emptyLabel="No extracted properties captured for this finding"
                                className="max-h-64"
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
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

      {/* Full run history + diff — Phase 4 (#26). */}
      <SimulatorAssessmentRunHistory assessment={assessment} customerId={selectedCustomerId} />
    </div>
  );
}
