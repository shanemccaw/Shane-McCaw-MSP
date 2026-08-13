import React from 'react';
import { SlidersHorizontal, ShieldAlert, CheckCircle2, CircleDashed, AlertTriangle } from 'lucide-react';
import { scoreBand } from '@/components/health-suite/useTopicHealthLive';
import type { CopilotReadinessLive } from '@/components/assessment-test/types';

/**
 * Enablement Checklist — the honest replacement for the mock enablement
 * toggle panel (its switches only flipped client state; no enablement API is
 * wired, and tenant writes are blocked pending the Azure app registration).
 *
 * What's real: a gate checklist derived from the real readiness indicators —
 * each gate is pass (≥70), attention (<70), or not-measured — plus the plain
 * statement that enablement changes are actioned with your MSP, not from
 * this screen.
 */

interface EnablementControlsProps {
  copilotReadiness: CopilotReadinessLive | null;
}

const GATES: { key: 'sharePointTeams' | 'sensitivityLabels' | 'dlp'; label: string; detail: string }[] = [
  { key: 'sharePointTeams', label: 'Content exposure reviewed', detail: 'Overshared sites & Teams tightened before rollout' },
  { key: 'sensitivityLabels', label: 'Labeling in place', detail: 'Sensitivity labels applied so Copilot honors protection' },
  { key: 'dlp', label: 'DLP guardrails active', detail: 'Policies strong enough to catch sensitive flows' },
];

export const EnablementControls: React.FC<EnablementControlsProps> = ({ copilotReadiness }) => {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
          ENABLEMENT CHECKLIST
        </h4>
      </div>

      <ul className="space-y-3 flex-grow">
        {GATES.map((gate) => {
          const score = copilotReadiness?.[gate.key]?.score ?? null;
          const state: 'pass' | 'attention' | 'unmeasured' =
            score == null ? 'unmeasured' : scoreBand(score) === 'green' ? 'pass' : 'attention';
          return (
            <li key={gate.key} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-secondary/40">
              {state === 'pass' ? (
                <CheckCircle2 className="w-4 h-4 text-status-green flex-shrink-0 mt-0.5" />
              ) : state === 'attention' ? (
                <AlertTriangle className="w-4 h-4 text-status-amber flex-shrink-0 mt-0.5" />
              ) : (
                <CircleDashed className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">{gate.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                  {state === 'unmeasured' ? 'Not measured yet — awaiting check data' : gate.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 p-3 bg-status-amber/5 border border-status-amber/30 rounded-xl text-[11px] text-secondary-foreground/90 flex items-start gap-2 leading-relaxed">
        <ShieldAlert className="w-4 h-4 text-status-amber flex-shrink-0 mt-0.5" />
        <span>
          Enablement changes run against your real tenant and are actioned with
          your MSP — automated execution unlocks once your Microsoft&nbsp;365 app
          registration is configured. Nothing is changed from this screen.
        </span>
      </div>
    </div>
  );
};
