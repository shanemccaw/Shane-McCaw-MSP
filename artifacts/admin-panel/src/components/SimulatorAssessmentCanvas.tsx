// artifacts/admin-panel/src/components/SimulatorAssessmentCanvas.tsx
//
// Center view for the Simulator Studio's "Assessments" node (Phase 1, Issue #23,
// simulator-studio-assessments). Mirrors SimulatorEndpointCanvas.tsx's shell —
// header, metadata, real stored config — but is READ-ONLY: no run, no save, no
// retire. Shows one real `services` (category='assessment') row's resolved
// packageKey (the same `type_attributes->>'packageKey'` path consent.ts
// resolves at scan time) and, when a dedicated package exists, that package's
// ordered check_key list.
//
// Deliberately NOT here (later phase, not yet built): execution, create/edit/
// delete of the packageKey assignment or of monitoring packages themselves.

import { ListChecks, AlertTriangle } from "lucide-react";
import type { AssessmentNode } from "./SimulatorLeftTree";

export function SimulatorAssessmentCanvas({ assessment }: { assessment: AssessmentNode }) {
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
      </div>

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
