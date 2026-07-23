import React from 'react';
import { KeyRound } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  resolvedEvents,
  riskCountBand,
  BAND_TEXT_CLASS,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * OAuth & Permission Risk — REAL permission-grant signal, replacing the mock
 * OAuth risk gauge. Real sources: the Graph-permission drift watcher
 * (drift.permissionDriftCount events), Dynamics service-principal permission
 * checks (permission grants, orphaned SPs), and consent-change audit events.
 * A per-grant OAuth consent inventory (which app has which scope) isn't
 * served yet — that needs a new Graph check; reported as a gap, not
 * simulated.
 */

interface OAuthPermissionRiskProps {
  metrics: Record<string, ResolvedMetric>;
}

const COUNT_ROWS: { key: string; label: string; risky: boolean }[] = [
  { key: 'dynamics.permissionGrantCount', label: 'Permission grants (Dynamics SPs)', risky: false },
  { key: 'dynamics.orphanedSpCount', label: 'Orphaned service principals', risky: true },
  { key: 'dynamics.appPermissionCount', label: 'App permissions', risky: false },
];

export const OAuthPermissionRisk: React.FC<OAuthPermissionRiskProps> = ({ metrics }) => {
  const permissionDrift = resolvedEvents(metrics['drift.permissionDriftCount']).map((e) => ({
    ...e,
    __tag: 'GRAPH PERM',
  }));
  const consentChanges = resolvedEvents(metrics['dynamics.consentChangeCount']).map((e) => ({
    ...e,
    __tag: 'CONSENT',
  }));
  const merged = [...permissionDrift, ...consentChanges]
    .filter((e) => e.t)
    .sort((a, b) => (a.t < b.t ? 1 : -1))
    .slice(0, 8);
  const watching =
    metrics['drift.permissionDriftCount']?.status === 'ok' ||
    metrics['dynamics.consentChangeCount']?.status === 'ok';

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-status-amber" />
          OAUTH &amp; PERMISSION RISK
        </h4>
        <span className="text-[10px] font-mono text-muted-foreground">
          {watching ? 'Watchers live' : 'Awaiting data'}
        </span>
      </div>

      <ul className="space-y-1.5 mb-4">
        {COUNT_ROWS.map(({ key, label, risky }) => {
          const value = resolvedValue(metrics[key]);
          const band = value != null && risky ? riskCountBand(value) : null;
          return (
            <li key={key} className="flex justify-between items-center text-[11px] font-mono">
              <span className="text-muted-foreground">{label}</span>
              <span
                className={`font-bold ${
                  band ? BAND_TEXT_CLASS[band] : value != null ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {value != null ? value.toLocaleString() : '—'}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">
        Permission &amp; consent change events
      </p>
      {merged.length > 0 ? (
        <ul className="divide-y divide-border flex-grow">
          {merged.map((e, i) => (
            <li key={`${e.t}-${i}`} className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-start gap-2">
                <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5 bg-status-amber/15 text-status-amber border-status-amber/30">
                  {e.__tag}
                </span>
                <span className="text-xs text-secondary-foreground/90 leading-relaxed break-words">
                  {e.label}
                </span>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
                {new Date(e.t).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex-grow flex items-center justify-center text-center px-4 py-6">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {watching
              ? 'No permission or consent changes in the look-back window.'
              : 'Permission-change events appear once the watchers have collected data for your tenant.'}
          </p>
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        A per-grant OAuth consent inventory isn&apos;t collected yet — these are
        your real permission checks and change events.
      </div>
    </div>
  );
};
