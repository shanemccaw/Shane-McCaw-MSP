import React from 'react';
import { Lock } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  resolvedEventCount,
  riskCountBand,
  BAND_TEXT_CLASS,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * Conditional Access Posture — REAL CA signal from the monitor checks,
 * replacing the mock per-policy map (a per-policy CA inventory isn't served by
 * any endpoint — that drill-down needs a new Graph check; reported as a gap,
 * not simulated). Real data: CA failure count (security:conditional-access-
 * failures), and the CA-policy / security-defaults drift watchers' real change
 * COUNTS.
 *
 * #1265: this panel previously also tried to render a per-change *event
 * timeline* via a bespoke `resolvedEvents(metrics['drift.caPolicyDriftCount'])`
 * merge. That local path was dead: the `drift.*` metrics are
 * `sourceType: "monitor_profile"`, which /api/dashboard/resolve always reduces
 * to a canonical `{ value }` — it never emits `{ events }` for a
 * non-`needs_aggregation` metric (see useTopicHealthLive's `resolvedEventCount`
 * note). There is also no producer of itemized drift-change events anywhere (no
 * `drift:*` checks exist in the monitor_checks catalog today), so
 * `resolvedEvents()` resolved to `[]` for every tenant. The bespoke event UI was
 * removed; only the real aggregate change counts (which the watchers genuinely
 * report) are rendered.
 *
 * The registry's `shape: "timeline"` / `valueType: "event-list"` declarations
 * are intentionally left as-is: they are load-bearing for the renderer registry
 * (`getValidRenderersForMetric` → Timeline, asserted in registry.test.ts) and
 * for the shared `EventTimelinePanel`, which is the correct forward-looking home
 * for a real per-event feed once a `drift:*` producer exists and already
 * degrades to the same honest count/awaiting states in the meantime.
 */

interface ConditionalAccessMapProps {
  metrics: Record<string, ResolvedMetric>;
}

export const ConditionalAccessMap: React.FC<ConditionalAccessMapProps> = ({ metrics }) => {
  const failures = resolvedValue(metrics['identity.caFailureCount']);
  const failureBand = failures != null ? riskCountBand(failures) : null;
  const watching =
    metrics['drift.caPolicyDriftCount']?.status === 'ok' ||
    metrics['drift.securityDefaultsDriftCount']?.status === 'ok';
  // The drift watchers resolve as plain counts (monitor_profile metrics never
  // emit a per-event array — #1265), so an absent count does NOT mean nothing
  // changed. Only a measured zero may be described as stable.
  const caDriftCount = resolvedEventCount(metrics['drift.caPolicyDriftCount']);
  const defaultsDriftCount = resolvedEventCount(metrics['drift.securityDefaultsDriftCount']);
  const driftTotal = (caDriftCount ?? 0) + (defaultsDriftCount ?? 0);
  const anyDriftCount = caDriftCount != null || defaultsDriftCount != null;

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-status-blue" />
          CONDITIONAL ACCESS POSTURE
        </h4>
        <span className="text-[10px] font-mono text-muted-foreground">
          {watching ? 'Drift watchers live' : 'Awaiting data'}
        </span>
      </div>

      <div className="p-3 rounded-lg border border-border bg-secondary/40 mb-4">
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          CA Failures (window)
        </p>
        <p
          className={`text-2xl font-bold font-mono mt-1 ${
            failureBand ? BAND_TEXT_CLASS[failureBand] : 'text-muted-foreground'
          }`}
        >
          {failures != null ? failures.toLocaleString() : '—'}
        </p>
        <p className="text-[10px] text-secondary-foreground/80 mt-0.5">
          {failures != null
            ? 'Real sign-ins blocked/failed by Conditional Access'
            : 'No CA failure data collected yet'}
        </p>
      </div>

      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">
        Policy change events
      </p>
      {anyDriftCount && driftTotal > 0 ? (
        <ul className="divide-y divide-border flex-grow">
          {[
            { tag: 'CA POLICY', count: caDriftCount },
            { tag: 'SEC DEFAULTS', count: defaultsDriftCount },
          ].map(({ tag, count }) => (
            <li key={tag} className="py-2 flex items-center justify-between gap-3">
              <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 bg-status-blue/15 text-status-blue border-status-blue/30">
                {tag}
              </span>
              <span className="text-[11px] text-secondary-foreground/90 flex-grow min-w-0 truncate">
                {count != null ? 'changes in the look-back window' : 'no data collected yet'}
              </span>
              <span
                className={`text-sm font-bold font-mono flex-shrink-0 ${
                  count != null ? BAND_TEXT_CLASS[riskCountBand(count)] : 'text-muted-foreground'
                }`}
              >
                {count != null ? count.toLocaleString() : '—'}
              </span>
            </li>
          ))}
          <li className="pt-2 text-[10px] text-muted-foreground leading-relaxed">
            Per-change detail isn&apos;t served by the metrics API yet — these are
            the real change counts your watchers reported.
          </li>
        </ul>
      ) : (
        <div className="flex-grow flex items-center justify-center text-center px-4 py-6">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {anyDriftCount
              ? 'No CA policy changes in the look-back window — your policies are stable.'
              : 'CA drift events appear once the drift watchers have collected data for your tenant.'}
          </p>
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        A per-policy CA inventory isn&apos;t collected yet (needs a new Graph
        check) — these are your real failure counts and change counts.
      </div>
    </div>
  );
};
