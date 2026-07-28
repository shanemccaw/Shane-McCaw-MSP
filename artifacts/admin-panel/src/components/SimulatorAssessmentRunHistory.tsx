// artifacts/admin-panel/src/components/SimulatorAssessmentRunHistory.tsx
//
// Run history + diff for the Simulator Studio's "Assessments" node
// (simulator-studio-assessments Phase 4, Issue #26). Sibling to
// SimulatorAssessmentCanvas.tsx (kept separate rather than growing that
// already-large file further), wired in at the bottom of its render.
//
// NO NEW BACKEND. Two existing routes cover this entirely:
//   - GET /api/msp/customers/:customerId/diagnostics/runs?limit=N
//     (msp-diagnostics.ts) — ALL runs for the customer, most-recent-first,
//     regardless of packageKey. The route has no server-side packageKey
//     filter and none was added to it (it's shared with customer-detail.tsx's
//     Diagnostics tab and the Phase 3 past-run picker in the canvas above);
//     instead this component filters client-side to runs whose stored
//     packageKey matches the selected assessment's resolved packageKey
//     (assessment.packageKey, or the core:security-baseline fallback for the
//     15 assessments still on it — CORE_SECURITY_BASELINE_FALLBACK below
//     must stay in sync with the same-named export in
//     admin-simulator-assessments.ts; there is no cross-app import path for
//     it, artifacts/* apps share code only via lib/* workspace packages).
//   - GET /api/msp/customers/:customerId/diagnostics/runs/:runId (already
//     used by the canvas above) — { run, findings } for any runId, used here
//     to fetch both sides of a diff.
//
// THE DIFF ITSELF IS NOT SimulatorRunHistory.tsx's diff. That one
// (GET /admin/monitor-check-runs/:runId/diff, simulator-run-diff.ts) is
// server-computed against the completely different simulator_check_runs
// table and does not apply to assessment runs. Only its UI/interaction
// pattern is mirrored here (checkbox-select exactly two runs, a Diff button
// that enables only at 2, a DiffView panel). The actual comparison
// (computeAssessmentFindingsDiff below) is new client-side logic over the
// two runs' own findings arrays — new / resolved / severity-changed /
// unchanged, matched by checkKey. When a checkKey produced more than one
// finding in a run (uncommon — most checks emit at most one), the two sides
// are compared using each side's single most-severe finding for that key,
// rather than trying to pair up arbitrary finding lists.
//
// Also mirrors SimulatorRunHistory's own disclosure pattern for the same
// class of caveat (its mappingChanged/propertiesChanged banner): if the two
// selected runs' stored packageKey differ, the panel says so explicitly
// instead of silently treating "the check disappeared" as if it meant the
// same thing as "the finding was genuinely resolved" — a package
// reassignment between the two runs can produce that same shape of diff for
// an unrelated reason.

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, GitCompare, History, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { SEVERITY_PRIORITY, type DiagnosticFinding } from "./SimulatorAssessmentCanvas";
import type { AssessmentNode } from "./SimulatorLeftTree";

// Mirrors admin-simulator-assessments.ts's CORE_SECURITY_BASELINE_FALLBACK —
// see the file-header comment for why this can't be a shared import.
const CORE_SECURITY_BASELINE_FALLBACK = "core:security-baseline";

// One row from GET .../diagnostics/runs — a plain array of the full
// msp_diagnostic_runs row shape (msp.ts), most-recent-first. Only the fields
// this view actually uses are declared.
interface DiagnosticRunRow {
  runId: string;
  status: string;
  packageKey: string;
  checksTotal: number;
  checksOk: number;
  checksError: number;
  checksRequiresScript: number;
  checksLicenseGap: number;
  createdAt: string;
  completedAt: string | null;
}

interface RunDetail {
  run: { runId: string; packageKey: string; [key: string]: unknown };
  findings: DiagnosticFinding[];
}

export interface AssessmentSeverityChange {
  checkKey: string;
  checkLabel: string;
  before: DiagnosticFinding["severity"];
  after: DiagnosticFinding["severity"];
}

export interface AssessmentFindingsDiff {
  newFindings: DiagnosticFinding[];
  resolvedFindings: DiagnosticFinding[];
  severityChanges: AssessmentSeverityChange[];
  unchangedCount: number;
}

/**
 * Categorizes two runs' findings arrays by checkKey:
 *  - new: checkKey present after, not before.
 *  - resolved: checkKey present before, not after.
 *  - severityChanges: checkKey present in both, most-severe severity differs.
 *  - unchangedCount: checkKey present in both, same most-severe severity.
 */
export function computeAssessmentFindingsDiff(
  before: DiagnosticFinding[],
  after: DiagnosticFinding[],
): AssessmentFindingsDiff {
  const mostSevere = (findings: DiagnosticFinding[]): DiagnosticFinding =>
    [...findings].sort((a, b) => SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity])[0]!;

  const groupByCheckKey = (findings: DiagnosticFinding[]): Map<string, DiagnosticFinding[]> => {
    const map = new Map<string, DiagnosticFinding[]>();
    for (const f of findings) map.set(f.checkKey, [...(map.get(f.checkKey) ?? []), f]);
    return map;
  };

  const beforeByKey = groupByCheckKey(before);
  const afterByKey = groupByCheckKey(after);

  const newFindings: DiagnosticFinding[] = [];
  const resolvedFindings: DiagnosticFinding[] = [];
  const severityChanges: AssessmentSeverityChange[] = [];
  let unchangedCount = 0;

  for (const [checkKey, afterList] of afterByKey) {
    const beforeList = beforeByKey.get(checkKey);
    if (!beforeList) {
      newFindings.push(...afterList);
      continue;
    }
    const b = mostSevere(beforeList);
    const a = mostSevere(afterList);
    if (b.severity !== a.severity) {
      severityChanges.push({ checkKey, checkLabel: a.checkLabel || b.checkLabel, before: b.severity, after: a.severity });
    } else {
      unchangedCount += 1;
    }
  }
  for (const [checkKey, beforeList] of beforeByKey) {
    if (!afterByKey.has(checkKey)) resolvedFindings.push(...beforeList);
  }

  return { newFindings, resolvedFindings, severityChanges, unchangedCount };
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SimulatorAssessmentRunHistory({
  assessment,
  customerId,
}: {
  assessment: AssessmentNode;
  customerId: number | null;
}) {
  const { fetchWithAuth } = useAuth();

  const resolvedPackageKey = assessment.packageKey ?? CORE_SECURITY_BASELINE_FALLBACK;

  const [expanded, setExpanded] = useState(false);
  const [runs, setRuns] = useState<DiagnosticRunRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState<string[]>([]);
  const [diffPair, setDiffPair] = useState<{ before: RunDetail; after: RunDetail } | null>(null);
  const [diffing, setDiffing] = useState(false);

  const load = useCallback(async () => {
    if (customerId == null) {
      setRuns([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/diagnostics/runs?limit=50`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to load run history");
        return;
      }
      const data = (await res.json()) as DiagnosticRunRow[];
      const filtered = (Array.isArray(data) ? data : []).filter((r) => r.packageKey === resolvedPackageKey);
      setRuns(filtered);
    } catch (err: any) {
      toast.error(err.message || "Network error loading run history");
    } finally {
      setLoading(false);
    }
  }, [customerId, resolvedPackageKey, fetchWithAuth]);

  // Reset every selection when a different assessment or testbed customer is
  // selected — a diff across two different assessments' runs is meaningless.
  useEffect(() => {
    setSelected([]);
    setDiffPair(null);
    setRuns([]);
    setExpanded(false);
  }, [assessment.id, customerId]);

  useEffect(() => {
    if (expanded) void load();
  }, [expanded, load]);

  const toggleSelected = (runId: string) => {
    setDiffPair(null);
    setSelected((prev) => {
      if (prev.includes(runId)) return prev.filter((r) => r !== runId);
      // Keep the two most recent picks; a third click replaces the older one.
      return [...prev, runId].slice(-2);
    });
  };

  const runDiff = async () => {
    if (selected.length !== 2 || customerId == null) return;
    setDiffing(true);
    try {
      // Order chronologically (older = before) rather than by click order —
      // the diff arrow should always read left-to-right in time.
      const [olderId, newerId] = [...selected].sort((a, b) => {
        const ra = runs.find((r) => r.runId === a);
        const rb = runs.find((r) => r.runId === b);
        return new Date(ra?.createdAt ?? 0).getTime() - new Date(rb?.createdAt ?? 0).getTime();
      });

      const [beforeRes, afterRes] = await Promise.all([
        fetchWithAuth(`/api/msp/customers/${customerId}/diagnostics/runs/${olderId}`),
        fetchWithAuth(`/api/msp/customers/${customerId}/diagnostics/runs/${newerId}`),
      ]);
      const [beforeData, afterData] = await Promise.all([beforeRes.json(), afterRes.json()]);
      if (!beforeRes.ok || !afterRes.ok) {
        toast.error(beforeData.error || afterData.error || "Failed to load runs for diff");
        return;
      }
      setDiffPair({
        before: { run: beforeData.run, findings: beforeData.findings ?? [] },
        after: { run: afterData.run, findings: afterData.findings ?? [] },
      });
    } catch (err: any) {
      toast.error(err.message || "Network error diffing runs");
    } finally {
      setDiffing(false);
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <History className="h-3.5 w-3.5" />
          History
          {runs.length > 0 && <span className="tabular-nums text-muted-foreground/60">({runs.length})</span>}
        </button>
        {expanded && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void load()}
              disabled={loading || customerId == null}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
            </button>
            <button
              onClick={() => void runDiff()}
              disabled={selected.length !== 2 || diffing}
              className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              title={
                selected.length === 2
                  ? "Compare the two selected runs"
                  : "Select two runs of this assessment to compare them"
              }
            >
              {diffing ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCompare className="h-3 w-3" />}
              Diff ({selected.length}/2)
            </button>
          </div>
        )}
      </div>

      {!expanded ? null : customerId == null ? (
        <p className="py-3 text-[11px] text-muted-foreground">Select a testbed customer first.</p>
      ) : loading && runs.length === 0 ? (
        <div className="flex items-center gap-2 py-4 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading run history…
        </div>
      ) : runs.length === 0 ? (
        <p className="py-3 text-[11px] text-muted-foreground">
          No stored runs of this assessment's <span className="font-mono">{resolvedPackageKey}</span> package for this
          customer yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-border">
          {runs.map((run) => {
            const picked = selected.indexOf(run.runId);
            return (
              <div
                key={run.runId}
                onClick={() => toggleSelected(run.runId)}
                className={`flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1.5 text-[11px] last:border-b-0 transition-colors hover:bg-accent ${
                  picked >= 0 ? "bg-accent/60" : ""
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[9px] font-bold ${
                    picked >= 0 ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent"
                  }`}
                >
                  {picked >= 0 ? picked + 1 : "0"}
                </span>
                <span className="w-[128px] shrink-0 font-mono text-muted-foreground">{formatWhen(run.createdAt)}</span>
                <span
                  className={`w-[72px] shrink-0 font-mono ${
                    run.status === "completed"
                      ? "text-emerald-400"
                      : run.status === "error" || run.status === "failed"
                        ? "text-destructive"
                        : "text-primary"
                  }`}
                >
                  {run.status}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono tabular-nums text-muted-foreground/80">
                  ok: {run.checksOk} · error: {run.checksError} · license-gap: {run.checksLicenseGap} / {run.checksTotal}{" "}
                  total
                </span>
              </div>
            );
          })}
        </div>
      )}

      {expanded && diffPair && <DiffView diffPair={diffPair} onClose={() => setDiffPair(null)} />}
    </div>
  );
}

const SEVERITY_LABEL: Record<DiagnosticFinding["severity"], string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
  ok: "OK",
};

function DiffView({
  diffPair,
  onClose,
}: {
  diffPair: { before: RunDetail; after: RunDetail };
  onClose: () => void;
}) {
  const { before, after } = diffPair;
  const diff = computeAssessmentFindingsDiff(before.findings, after.findings);
  const nothingMoved = diff.newFindings.length === 0 && diff.resolvedFindings.length === 0 && diff.severityChanges.length === 0;
  const packageKeyDiffered = before.run.packageKey !== after.run.packageKey;

  return (
    <div className="mt-3 rounded border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          <GitCompare className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="font-mono text-muted-foreground">before</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          <span className="font-mono text-foreground">after</span>
        </div>
        <button onClick={onClose} className="shrink-0 text-muted-foreground transition-colors hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* A check that "disappeared" because the assessment's PACKAGE was
          reassigned between these two runs is a different finding from one
          that was genuinely resolved on the tenant — never let the operator
          assume the first is the second. Mirrors SimulatorRunHistory.tsx's
          own mappingChanged/propertiesChanged disclosure for this same class
          of caveat. */}
      {packageKeyDiffered && (
        <div className="border-b border-border bg-amber-400/10 px-2.5 py-1.5 text-[10px] text-amber-300">
          These two runs used different packageKeys (
          <span className="font-mono">{before.run.packageKey}</span> →{" "}
          <span className="font-mono">{after.run.packageKey}</span>). Some of the differences below may come from that
          reassignment rather than from the tenant's data.
        </div>
      )}

      {nothingMoved ? (
        <p className="px-2.5 py-3 text-[11px] text-muted-foreground">
          Nothing changed — {diff.unchangedCount} check(s) are identical across both runs.
        </p>
      ) : (
        <div className="divide-y divide-border">
          <div className="px-2.5 py-2">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                New findings
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">{diff.newFindings.length}</span>
            </div>
            {diff.newFindings.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/70">No checks newly finding something.</p>
            ) : (
              <div className="space-y-1">
                {diff.newFindings.map((f) => (
                  <div key={f.findingId} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                    <span className="rounded-sm bg-emerald-400/15 px-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-400">
                      new
                    </span>
                    <span className="font-mono text-foreground">{f.checkLabel || f.checkKey}</span>
                    <span className="text-muted-foreground">{f.title}</span>
                    <span className="text-[10px] text-muted-foreground/70">({SEVERITY_LABEL[f.severity]})</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="px-2.5 py-2">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Resolved findings
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">{diff.resolvedFindings.length}</span>
            </div>
            {diff.resolvedFindings.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/70">No checks stopped finding something.</p>
            ) : (
              <div className="space-y-1">
                {diff.resolvedFindings.map((f) => (
                  <div key={f.findingId} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                    <span className="rounded-sm bg-destructive/15 px-1 text-[9px] font-semibold uppercase tracking-wider text-destructive">
                      resolved
                    </span>
                    <span className="font-mono text-foreground">{f.checkLabel || f.checkKey}</span>
                    <span className="text-muted-foreground">{f.title}</span>
                    <span className="text-[10px] text-muted-foreground/70">({SEVERITY_LABEL[f.severity]})</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="px-2.5 py-2">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Severity changes
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">
                {diff.severityChanges.length} changed · {diff.unchangedCount} unchanged
              </span>
            </div>
            {diff.severityChanges.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/70">
                Every check present in both runs kept the same severity.
              </p>
            ) : (
              <div className="space-y-1">
                {diff.severityChanges.map((c) => (
                  <div key={c.checkKey} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                    <span className="font-mono text-foreground">{c.checkLabel || c.checkKey}</span>
                    <span className="font-mono text-muted-foreground/70 line-through">{SEVERITY_LABEL[c.before]}</span>
                    <ArrowRight className="h-3 w-3 self-center text-muted-foreground/50" />
                    <span className="font-mono text-foreground">{SEVERITY_LABEL[c.after]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
